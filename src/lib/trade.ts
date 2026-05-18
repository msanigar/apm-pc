/**
 * Trade comparison domain logic.
 *
 * The in-game Adopt Me trade window holds up to 18 items per player; each
 * pet/item instance occupies its own slot (no quantity stack). We model the
 * same: a `TradeSide` is an ordered array of `(itemSlug, variant)` pairs,
 * capped at 18.
 *
 * All helpers are pure and runtime-free so they can be unit-tested without
 * a DOM. The localStorage helpers no-op outside the browser.
 */
import type { SearchIndexItem, Variant } from "@shared/types";
import { isValidVariant } from "@shared/variants";

export const MAX_SLOTS_PER_SIDE = 18;

export type TradeSlot = {
  itemSlug: string;
  variant: Variant;
};

export type TradeSide = {
  slots: TradeSlot[];
};

export type TradeSideName = "left" | "right";

export type TradeState = {
  left: TradeSide;
  right: TradeSide;
};

export type TradeSideTotals = {
  /** Sum of valueRp across slots that resolved to an aggregated value. */
  knownRp: number;
  /** Number of slots whose item/variant has no aggregated value. */
  unknownCount: number;
  slotCount: number;
};

/**
 * Verdict thresholds (percentage of the larger side):
 *   <5%   → "even"
 *   5–15% → "slight" favor
 *   >15%  → "heavy" favor
 */
export const EVEN_THRESHOLD = 0.05;
export const SLIGHT_THRESHOLD = 0.15;

export type TradeVerdict =
  | { kind: "empty" }
  | { kind: "even"; deltaRp: number }
  | { kind: "slight"; favors: TradeSideName; deltaRp: number; deltaPct: number }
  | { kind: "heavy"; favors: TradeSideName; deltaRp: number; deltaPct: number };

export function makeEmptyState(): TradeState {
  return { left: { slots: [] }, right: { slots: [] } };
}

export function canAddSlot(side: TradeSide): boolean {
  return side.slots.length < MAX_SLOTS_PER_SIDE;
}

export function isStateEmpty(state: TradeState): boolean {
  return state.left.slots.length === 0 && state.right.slots.length === 0;
}

export function slotValueRp(
  slot: TradeSlot,
  item: SearchIndexItem | undefined
): number | null {
  if (!item) return null;
  const v = item.values[slot.variant];
  if (!v) return null;
  return v.valueRp;
}

export function sideTotals(
  side: TradeSide,
  bySlug: Map<string, SearchIndexItem>
): TradeSideTotals {
  let knownRp = 0;
  let unknownCount = 0;
  for (const slot of side.slots) {
    const item = bySlug.get(slot.itemSlug);
    const value = slotValueRp(slot, item);
    if (value == null) unknownCount += 1;
    else knownRp += value;
  }
  return { knownRp, unknownCount, slotCount: side.slots.length };
}

export function balanceVerdict(
  left: TradeSideTotals,
  right: TradeSideTotals
): TradeVerdict {
  if (left.slotCount === 0 || right.slotCount === 0) return { kind: "empty" };

  const deltaRp = left.knownRp - right.knownRp;
  const ref = Math.max(left.knownRp, right.knownRp);
  // Both sides genuinely have items but neither has any usable RP value.
  // Treat as empty rather than dividing by zero.
  if (ref === 0) return { kind: "empty" };

  const pct = Math.abs(deltaRp) / ref;
  const favors: TradeSideName = deltaRp > 0 ? "left" : "right";

  if (pct < EVEN_THRESHOLD) return { kind: "even", deltaRp: Math.abs(deltaRp) };
  if (pct < SLIGHT_THRESHOLD)
    return { kind: "slight", favors, deltaRp: Math.abs(deltaRp), deltaPct: pct };
  return { kind: "heavy", favors, deltaRp: Math.abs(deltaRp), deltaPct: pct };
}

/* ─────────────────────── slot mutations (pure) ─────────────────────── */

export function addSlot(side: TradeSide, slot: TradeSlot): TradeSide {
  if (!canAddSlot(side)) return side;
  return { slots: [...side.slots, slot] };
}

export function removeSlotAt(side: TradeSide, index: number): TradeSide {
  return { slots: side.slots.filter((_, i) => i !== index) };
}

export function clearSide(): TradeSide {
  return { slots: [] };
}

export function swapSides(state: TradeState): TradeState {
  return { left: state.right, right: state.left };
}

/* ───────────────────────── URL serialisation ───────────────────────── */

/**
 * Encoding: `?l=alicorn:fly_ride,shadow-dragon:neon_fly_ride&r=...`
 *
 * Slugs are kebab-case ASCII (no commas, no colons), and variants are
 * the fixed string union from `Variant`. Both safe for an unencoded query
 * string; we still let `URLSearchParams` handle escaping on the way out.
 */
function encodeSide(side: TradeSide): string {
  return side.slots.map((s) => `${s.itemSlug}:${s.variant}`).join(",");
}

function decodeSide(encoded: string | null): TradeSide {
  if (!encoded) return { slots: [] };
  const slots: TradeSlot[] = [];
  for (const part of encoded.split(",")) {
    if (!part) continue;
    const [slugRaw, variantRaw] = part.split(":");
    const slug = (slugRaw ?? "").trim();
    if (!slug) continue;
    // Fall back to "regular" so a stale link with a deprecated variant still
    // loads instead of failing. Pets get a real variant; non-pets default to
    // their only valid variant anyway.
    const variant =
      variantRaw && isValidVariant(variantRaw.trim()) ? variantRaw.trim() : "regular";
    slots.push({ itemSlug: slug, variant: variant as Variant });
    if (slots.length >= MAX_SLOTS_PER_SIDE) break;
  }
  return { slots };
}

export function encodeToQuery(state: TradeState): string {
  const params = new URLSearchParams();
  const l = encodeSide(state.left);
  const r = encodeSide(state.right);
  if (l) params.set("l", l);
  if (r) params.set("r", r);
  return params.toString();
}

export function decodeFromQuery(query: string | URLSearchParams): TradeState {
  const params =
    typeof query === "string"
      ? new URLSearchParams(query.startsWith("?") ? query.slice(1) : query)
      : query;
  return {
    left: decodeSide(params.get("l")),
    right: decodeSide(params.get("r")),
  };
}

/* ────────────────────── localStorage draft ────────────────────── */

const DRAFT_KEY = "amvc:trade-draft";

export function loadDraftFromStorage(): TradeState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const decoded = decodeFromQuery(raw);
    return isStateEmpty(decoded) ? null : decoded;
  } catch {
    return null;
  }
}

export function saveDraftToStorage(state: TradeState): void {
  if (typeof window === "undefined") return;
  try {
    const encoded = encodeToQuery(state);
    if (!encoded) window.localStorage.removeItem(DRAFT_KEY);
    else window.localStorage.setItem(DRAFT_KEY, encoded);
  } catch {
    /* private mode / quota — ignore */
  }
}
