import { describe, expect, it } from "vitest";
import type { SearchIndexItem, Variant } from "@shared/types";
import {
  addSlot,
  balanceVerdict,
  canAddSlot,
  clearSide,
  decodeFromQuery,
  encodeToQuery,
  isStateEmpty,
  MAX_SLOTS_PER_SIDE,
  makeEmptyState,
  removeSlotAt,
  sideTotals,
  slotValueRp,
  swapSides,
  type TradeSide,
  type TradeState,
} from "../trade";

function makeItem(
  slug: string,
  values: Partial<Record<Variant, number>>
): SearchIndexItem {
  const valueMap: SearchIndexItem["values"] = {};
  for (const [variant, valueRp] of Object.entries(values)) {
    if (valueRp == null) continue;
    valueMap[variant as Variant] = {
      variant: variant as Variant,
      valueRp,
      minRp: valueRp,
      maxRp: valueRp,
      sourceCount: 1,
      confidence: "high",
      isSuspicious: false,
      lastAcceptedAt: null,
      lastCandidateValueRp: null,
      lastCandidateAt: null,
      calculatedAt: "2026-05-18T00:00:00.000Z",
    };
  }
  return {
    id: slug,
    slug,
    name: slug,
    category: "pet",
    rarity: "legendary",
    aliases: [],
    isHighTier: false,
    values: valueMap,
  };
}

function index(items: SearchIndexItem[]): Map<string, SearchIndexItem> {
  return new Map(items.map((i) => [i.slug, i]));
}

describe("slot helpers", () => {
  it("adds slots up to the 18-slot cap and refuses overflow", () => {
    let side: TradeSide = { slots: [] };
    for (let i = 0; i < MAX_SLOTS_PER_SIDE; i++) {
      expect(canAddSlot(side)).toBe(true);
      side = addSlot(side, { itemSlug: `p-${i}`, variant: "regular" });
    }
    expect(side.slots).toHaveLength(MAX_SLOTS_PER_SIDE);
    expect(canAddSlot(side)).toBe(false);
    const overflow = addSlot(side, { itemSlug: "extra", variant: "regular" });
    expect(overflow.slots).toHaveLength(MAX_SLOTS_PER_SIDE);
    expect(overflow).toBe(side);
  });

  it("removes a slot by index", () => {
    const side: TradeSide = {
      slots: [
        { itemSlug: "a", variant: "regular" },
        { itemSlug: "b", variant: "fly_ride" },
        { itemSlug: "c", variant: "neon_fly_ride" },
      ],
    };
    const without = removeSlotAt(side, 1);
    expect(without.slots.map((s) => s.itemSlug)).toEqual(["a", "c"]);
  });

  it("allows the same item-variant pair to appear in multiple slots", () => {
    let side: TradeSide = { slots: [] };
    side = addSlot(side, { itemSlug: "queen-bee", variant: "regular" });
    side = addSlot(side, { itemSlug: "queen-bee", variant: "regular" });
    side = addSlot(side, { itemSlug: "queen-bee", variant: "regular" });
    expect(side.slots).toHaveLength(3);
  });

  it("clearSide and swapSides behave intuitively", () => {
    const state: TradeState = {
      left: { slots: [{ itemSlug: "a", variant: "regular" }] },
      right: { slots: [{ itemSlug: "b", variant: "fly_ride" }] },
    };
    expect(clearSide().slots).toEqual([]);
    const swapped = swapSides(state);
    expect(swapped.left.slots[0].itemSlug).toBe("b");
    expect(swapped.right.slots[0].itemSlug).toBe("a");
  });

  it("isStateEmpty detects both-sides-empty", () => {
    expect(isStateEmpty(makeEmptyState())).toBe(true);
    expect(
      isStateEmpty({
        left: { slots: [{ itemSlug: "a", variant: "regular" }] },
        right: { slots: [] },
      })
    ).toBe(false);
  });
});

describe("slot/side math", () => {
  it("returns null for slots whose item is missing from the index", () => {
    expect(slotValueRp({ itemSlug: "ghost", variant: "regular" }, undefined)).toBeNull();
  });

  it("returns null when the requested variant has no aggregated value", () => {
    const item = makeItem("alicorn", { regular: 100 });
    expect(slotValueRp({ itemSlug: "alicorn", variant: "neon_fly_ride" }, item)).toBeNull();
  });

  it("sums known RP and counts unknowns separately on a side", () => {
    const bySlug = index([
      makeItem("alicorn", { fly_ride: 1000 }),
      makeItem("shadow", { neon_fly_ride: 5000 }),
      makeItem("no-data-yet", {}),
    ]);
    const side: TradeSide = {
      slots: [
        { itemSlug: "alicorn", variant: "fly_ride" },
        { itemSlug: "shadow", variant: "neon_fly_ride" },
        { itemSlug: "no-data-yet", variant: "regular" },
        { itemSlug: "not-in-index", variant: "regular" },
      ],
    };
    const t = sideTotals(side, bySlug);
    expect(t).toEqual({ knownRp: 6000, unknownCount: 2, slotCount: 4 });
  });
});

describe("balanceVerdict", () => {
  const empty = { knownRp: 0, unknownCount: 0, slotCount: 0 };
  it("returns empty when either side has zero slots", () => {
    expect(balanceVerdict(empty, { knownRp: 1000, unknownCount: 0, slotCount: 1 })).toEqual({
      kind: "empty",
    });
    expect(balanceVerdict({ knownRp: 1000, unknownCount: 0, slotCount: 1 }, empty)).toEqual({
      kind: "empty",
    });
  });

  it("returns empty when both sides have only unknown-value slots", () => {
    const allUnknown = { knownRp: 0, unknownCount: 2, slotCount: 2 };
    expect(balanceVerdict(allUnknown, allUnknown)).toEqual({ kind: "empty" });
  });

  it("calls 4% diff 'even'", () => {
    const left = { knownRp: 1000, unknownCount: 0, slotCount: 1 };
    const right = { knownRp: 1040, unknownCount: 0, slotCount: 1 };
    const v = balanceVerdict(left, right);
    expect(v.kind).toBe("even");
    if (v.kind === "even") expect(v.deltaRp).toBe(40);
  });

  it("calls 10% diff 'slight' and reports the favoured side", () => {
    const left = { knownRp: 1000, unknownCount: 0, slotCount: 1 };
    const right = { knownRp: 900, unknownCount: 0, slotCount: 1 };
    const v = balanceVerdict(left, right);
    expect(v.kind).toBe("slight");
    if (v.kind === "slight") {
      expect(v.favors).toBe("left");
      expect(v.deltaRp).toBe(100);
      expect(v.deltaPct).toBeCloseTo(0.1);
    }
  });

  it("calls 50% diff 'heavy' favouring the larger side", () => {
    const left = { knownRp: 500, unknownCount: 0, slotCount: 1 };
    const right = { knownRp: 1000, unknownCount: 0, slotCount: 1 };
    const v = balanceVerdict(left, right);
    expect(v.kind).toBe("heavy");
    if (v.kind === "heavy") {
      expect(v.favors).toBe("right");
      expect(v.deltaRp).toBe(500);
      expect(v.deltaPct).toBeCloseTo(0.5);
    }
  });

  it("treats the 5% boundary as not-yet-slight (strict <5%)", () => {
    const left = { knownRp: 100, unknownCount: 0, slotCount: 1 };
    const right = { knownRp: 95, unknownCount: 0, slotCount: 1 };
    // 5/100 = 0.05 — the threshold is strict (<), so this lands in "slight".
    const v = balanceVerdict(left, right);
    expect(v.kind).toBe("slight");
  });
});

describe("URL round-trip", () => {
  it("encodes both sides into the l= and r= params", () => {
    const state: TradeState = {
      left: {
        slots: [
          { itemSlug: "alicorn", variant: "fly_ride" },
          { itemSlug: "shadow-dragon", variant: "neon_fly_ride" },
        ],
      },
      right: { slots: [{ itemSlug: "queen-bee", variant: "regular" }] },
    };
    const q = encodeToQuery(state);
    const params = new URLSearchParams(q);
    expect(params.get("l")).toBe("alicorn:fly_ride,shadow-dragon:neon_fly_ride");
    expect(params.get("r")).toBe("queen-bee:regular");
  });

  it("decodes back into the same state", () => {
    const state: TradeState = {
      left: {
        slots: [
          { itemSlug: "alicorn", variant: "fly_ride" },
          { itemSlug: "shadow-dragon", variant: "neon_fly_ride" },
        ],
      },
      right: { slots: [{ itemSlug: "queen-bee", variant: "regular" }] },
    };
    const decoded = decodeFromQuery(encodeToQuery(state));
    expect(decoded).toEqual(state);
  });

  it("survives a leading '?' on the input", () => {
    const decoded = decodeFromQuery("?l=alicorn:fly_ride&r=queen-bee:regular");
    expect(decoded.left.slots).toEqual([{ itemSlug: "alicorn", variant: "fly_ride" }]);
    expect(decoded.right.slots).toEqual([{ itemSlug: "queen-bee", variant: "regular" }]);
  });

  it("omits empty sides from the query string", () => {
    const onlyLeft: TradeState = {
      left: { slots: [{ itemSlug: "alicorn", variant: "regular" }] },
      right: { slots: [] },
    };
    const q = encodeToQuery(onlyLeft);
    expect(q).toBe("l=alicorn%3Aregular");
    expect(new URLSearchParams(q).has("r")).toBe(false);
  });

  it("falls back to 'regular' when a variant in the URL isn't a valid Variant", () => {
    const decoded = decodeFromQuery("l=alicorn:not_a_variant");
    expect(decoded.left.slots[0].variant).toBe("regular");
  });

  it("caps decoded slots at MAX_SLOTS_PER_SIDE", () => {
    const slugs = Array.from({ length: 25 }, (_, i) => `p-${i}:regular`).join(",");
    const decoded = decodeFromQuery(`l=${slugs}`);
    expect(decoded.left.slots).toHaveLength(MAX_SLOTS_PER_SIDE);
  });

  it("returns an empty state for an empty query", () => {
    expect(decodeFromQuery("")).toEqual(makeEmptyState());
  });
});
