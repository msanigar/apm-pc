import { describe, expect, it } from "vitest";
import {
  diffDatasets,
  isIncompleteFetchFatal,
  keyOf,
  selectRowsForDeltaPromotion,
  splitSafeAndSuspiciousRows,
  validateCandidateDataset,
} from "../validate";
import type {
  CandidateDataset,
  CandidateRow,
  LiveDataset,
  LiveRow,
  Variant,
} from "../types";

function liveRow(
  slug: string,
  variant: Variant,
  valueRp: number,
  opts: { sourceCount?: number; isHighTier?: boolean } = {}
): LiveRow {
  return {
    itemSlug: slug,
    variant,
    valueRp,
    sourceCount: opts.sourceCount ?? 3,
    isSuspicious: false,
    isHighTier: opts.isHighTier ?? false,
  };
}

function candRow(
  slug: string,
  variant: Variant,
  values: number[],
  sources: string[] = ["a", "b", "c"].slice(0, values.length)
): CandidateRow {
  return { itemSlug: slug, variant, values, sources };
}

function makeLive(rows: LiveRow[]): LiveDataset {
  return { rows };
}

function makeCand(rows: CandidateRow[], sources = ["a", "b", "c"]): CandidateDataset {
  return { rows, sourceNames: sources };
}

describe("diffDatasets", () => {
  it("classifies live-only, candidate-only and common rows", () => {
    const live = makeLive([
      liveRow("dog", "regular", 100),
      liveRow("cat", "regular", 200),
    ]);
    const cand = makeCand([
      candRow("dog", "regular", [105, 110, 100]),
      candRow("turtle", "regular", [300, 310, 320]),
    ]);

    const diff = diffDatasets(live, cand);
    expect(diff.common.map((c) => c.live.itemSlug)).toEqual(["dog"]);
    expect(diff.liveOnly.map((l) => l.itemSlug)).toEqual(["cat"]);
    expect(diff.candidateOnly.map((c) => c.itemSlug)).toEqual(["turtle"]);
    expect(diff.common[0].candidateValueRp).toBe(105);
    expect(diff.common[0].percentChange).toBe(5);
  });
});

describe("validateCandidateDataset", () => {
  it("allows a single normal-tier item changing by 5%", () => {
    const live = makeLive([liveRow("dog", "regular", 100)]);
    const cand = makeCand([candRow("dog", "regular", [105, 105, 105])]);
    const diff = diffDatasets(live, cand);
    const v = validateCandidateDataset(live, cand, diff);
    expect(v.fatal).toBe(false);
    expect(v.suspiciousKeys.has(keyOf("dog", "regular"))).toBe(false);
  });

  it("holds back a high-tier item that changes by 30%", () => {
    const live = makeLive([
      liveRow("shadow-dragon", "regular", 100, { isHighTier: true }),
    ]);
    const cand = makeCand([candRow("shadow-dragon", "regular", [130, 130, 130])]);
    const diff = diffDatasets(live, cand);
    const v = validateCandidateDataset(live, cand, diff);
    expect(v.suspiciousKeys.has(keyOf("shadow-dragon", "regular"))).toBe(true);
    expect(v.issues.find((i) => i.issueType === "high_tier_item_swing")).toBeTruthy();
  });

  it("rejects the whole import when 30% of items go missing", () => {
    const live = makeLive(
      Array.from({ length: 10 }, (_, i) => liveRow(`pet-${i}`, "regular", 100))
    );
    // Only 7 of 10 items present (30% missing → coverage 70% < 90%).
    const cand = makeCand(
      Array.from({ length: 7 }, (_, i) =>
        candRow(`pet-${i}`, "regular", [100, 100, 100])
      )
    );
    const diff = diffDatasets(live, cand);
    const v = validateCandidateDataset(live, cand, diff);
    expect(v.fatal).toBe(true);
    expect(v.issues.find((i) => i.issueType === "too_few_items")).toBeTruthy();
  });

  it("rejects when source coverage collapses", () => {
    const live = makeLive(
      Array.from({ length: 10 }, (_, i) =>
        liveRow(`pet-${i}`, "regular", 100, { sourceCount: 3 })
      )
    );
    // Candidate has same items but only 1 source each → coverage 33%.
    const cand = makeCand(
      Array.from({ length: 10 }, (_, i) =>
        candRow(`pet-${i}`, "regular", [100], ["a"])
      )
    );
    const diff = diffDatasets(live, cand);
    const v = validateCandidateDataset(live, cand, diff);
    expect(v.fatal).toBe(true);
    expect(
      v.issues.find((i) => i.issueType === "source_coverage_dropped")
    ).toBeTruthy();
  });

  it("allows a new item but flags it", () => {
    const live = makeLive([liveRow("dog", "regular", 100)]);
    const cand = makeCand([
      candRow("dog", "regular", [100, 100, 100]),
      candRow("brand-new", "regular", [200, 200, 200]),
    ]);
    const diff = diffDatasets(live, cand);
    const v = validateCandidateDataset(live, cand, diff);
    expect(v.fatal).toBe(false);
    expect(v.issues.find((i) => i.issueType === "new_item")?.itemSlug).toBe(
      "brand-new"
    );
    expect(v.suspiciousKeys.has(keyOf("brand-new", "regular"))).toBe(false);
  });

  it("keeps old value and flags 'missing_item' when candidate lacks a row", () => {
    // 20 live items, candidate has 19 of them → 95% coverage, comfortably above
    // the 90% min coverage rule, so the import is not fatal.
    const live = makeLive(
      Array.from({ length: 20 }, (_, i) => liveRow(`pet-${i}`, "regular", 100))
    );
    const cand = makeCand(
      Array.from({ length: 19 }, (_, i) =>
        candRow(`pet-${i}`, "regular", [100, 100, 100])
      )
    );
    const diff = diffDatasets(live, cand);
    const v = validateCandidateDataset(live, cand, diff);
    expect(v.fatal).toBe(false);
    expect(
      v.issues.find(
        (i) => i.issueType === "missing_item" && i.itemSlug === "pet-19"
      )
    ).toBeTruthy();
  });

  it("on first import (empty live), nothing is suspicious", () => {
    const live = makeLive([]);
    const cand = makeCand([candRow("dog", "regular", [9999, 9999, 9999])]);
    const diff = diffDatasets(live, cand);
    const v = validateCandidateDataset(live, cand, diff);
    expect(v.fatal).toBe(false);
    expect(v.suspiciousKeys.size).toBe(0);
  });
});

describe("selectRowsForDeltaPromotion", () => {
  it("promotes the full candidate when fatal is due to incomplete fetch", () => {
    const live = makeLive(
      Array.from({ length: 100 }, (_, i) => liveRow(`pet-${i}`, "regular", 100))
    );
    const cand = makeCand(
      Array.from({ length: 7 }, (_, i) =>
        candRow(`pet-${i}`, "regular", [100, 100, 100])
      )
    );
    const diff = diffDatasets(live, cand);
    const v = validateCandidateDataset(live, cand, diff);
    expect(v.fatal).toBe(true);
    expect(isIncompleteFetchFatal(v)).toBe(true);
    expect(selectRowsForDeltaPromotion(cand, diff, v)).toEqual(cand.rows);
  });

  it("promotes only candidate-only rows for other fatal reasons", () => {
    const live = makeLive([liveRow("dog", "regular", 100)]);
    const cand = makeCand([
      candRow("dog", "regular", [100, 100, 100]),
      candRow("brand-new", "regular", [200, 200, 200]),
    ]);
    const diff = diffDatasets(live, cand);
    const v = validateCandidateDataset(live, cand, diff);
    expect(v.fatal).toBe(false);
    // Simulate a non-coverage fatal by using empty live — not fatal.
    // Force a synthetic validation object for the branch we care about.
    const fatalMedian = {
      ...v,
      fatal: true,
      issues: [
        {
          issueType: "dataset_median_shift" as const,
          severity: "fatal" as const,
          message: "shift",
        },
      ],
    };
    expect(isIncompleteFetchFatal(fatalMedian)).toBe(false);
    expect(selectRowsForDeltaPromotion(cand, diff, fatalMedian).map((r) => r.itemSlug)).toEqual([
      "brand-new",
    ]);
  });
});

describe("splitSafeAndSuspiciousRows", () => {
  it("splits according to the validation suspicious set", () => {
    const live = makeLive([
      liveRow("shadow-dragon", "regular", 100, { isHighTier: true }),
      liveRow("dog", "regular", 100),
    ]);
    const cand = makeCand([
      candRow("shadow-dragon", "regular", [130, 130, 130]),
      candRow("dog", "regular", [105, 105, 105]),
    ]);
    const diff = diffDatasets(live, cand);
    const v = validateCandidateDataset(live, cand, diff);
    const { safeRows, heldBackRows } = splitSafeAndSuspiciousRows(cand, v);
    expect(safeRows.map((r) => r.itemSlug)).toEqual(["dog"]);
    expect(heldBackRows.map((r) => r.itemSlug)).toEqual(["shadow-dragon"]);
  });
});
