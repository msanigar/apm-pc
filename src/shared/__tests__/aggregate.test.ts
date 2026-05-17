import { describe, expect, it } from "vitest";
import { aggregateValues, confidenceFor } from "../aggregate";

describe("aggregateValues", () => {
  it("throws on empty input", () => {
    expect(() => aggregateValues([])).toThrowError(/no values/i);
  });

  it("returns the single value for one-source data", () => {
    expect(aggregateValues([100])).toEqual({
      valueRp: 100,
      minRp: 100,
      maxRp: 100,
      sourceCount: 1,
      outlierCount: 0,
    });
  });

  it("uses the mean for two-source data", () => {
    expect(aggregateValues([100, 120])).toEqual({
      valueRp: 110,
      minRp: 100,
      maxRp: 120,
      sourceCount: 2,
      outlierCount: 0,
    });
  });

  it("uses the median for three tightly-clustered sources", () => {
    expect(aggregateValues([100, 110, 130])).toEqual({
      valueRp: 110,
      minRp: 100,
      maxRp: 130,
      sourceCount: 3,
      outlierCount: 0,
    });
  });

  it("drops a 5x+ outlier above the median", () => {
    // 100, 110, 800: median=110, outlier threshold = [22, 550], 800 drops.
    expect(aggregateValues([100, 110, 800])).toEqual({
      valueRp: 105,
      minRp: 100,
      maxRp: 110,
      sourceCount: 2,
      outlierCount: 1,
    });
  });

  it("drops a 5x+ outlier below the median (real-world: Bat Dragon)", () => {
    // AMVerse=0.12 vs AMTV=550 vs Gizmo=723: median=550, threshold=[110, 2750].
    // 0.12 falls outside → drop. Survivors: [550, 723], median=636.5.
    expect(aggregateValues([0.12, 550, 723])).toEqual({
      valueRp: 636.5,
      minRp: 550,
      maxRp: 723,
      sourceCount: 2,
      outlierCount: 1,
    });
  });

  it("does not drop outliers when median is too small to test (≤0.5 RP)", () => {
    // Tiny commons like Ant variants — a "5x off" gap is noise, not error.
    expect(aggregateValues([0.07, 0.34, 0.5])).toEqual({
      valueRp: 0.34,
      minRp: 0.07,
      maxRp: 0.5,
      sourceCount: 3,
      outlierCount: 0,
    });
  });

  it("averages the middle two for even-length 4+ source data", () => {
    // [100, 110, 130, 140]: median=120, threshold=[24, 600], nothing drops.
    expect(aggregateValues([100, 110, 130, 140])).toEqual({
      valueRp: 120,
      minRp: 100,
      maxRp: 140,
      sourceCount: 4,
      outlierCount: 0,
    });
  });

  it("works regardless of input ordering", () => {
    expect(aggregateValues([800, 110, 100]).valueRp).toBe(105);
  });

  it("falls back to the raw set if every value would be rejected", () => {
    // Pathological: extreme outliers on both sides of a tiny median group.
    // Guard against returning NaN/empty: keep the raw values.
    const result = aggregateValues([1, 100, 10000]);
    expect(result.sourceCount).toBeGreaterThan(0);
    expect(Number.isFinite(result.valueRp)).toBe(true);
  });
});

describe("confidenceFor", () => {
  it("returns low for 0 or 1 source", () => {
    expect(confidenceFor(0, 0, 0)).toBe("low");
    expect(confidenceFor(1, 100, 100)).toBe("low");
  });

  it("returns medium for two tight sources", () => {
    expect(confidenceFor(2, 100, 110)).toBe("medium");
  });

  it("returns low for two wide sources", () => {
    expect(confidenceFor(2, 100, 200)).toBe("low");
  });

  it("returns high for 3+ tight sources", () => {
    expect(confidenceFor(3, 100, 110)).toBe("high");
  });

  it("returns medium for 3+ moderately spread sources", () => {
    expect(confidenceFor(3, 100, 125)).toBe("medium");
  });

  it("returns low for 3+ widely spread sources", () => {
    expect(confidenceFor(3, 100, 200)).toBe("low");
  });
});
