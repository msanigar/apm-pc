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
    });
  });

  it("uses the mean for two-source data", () => {
    expect(aggregateValues([100, 120])).toEqual({
      valueRp: 110,
      minRp: 100,
      maxRp: 120,
      sourceCount: 2,
    });
  });

  it("uses the median for three-source data (rejects outliers)", () => {
    expect(aggregateValues([100, 110, 500])).toEqual({
      valueRp: 110,
      minRp: 100,
      maxRp: 500,
      sourceCount: 3,
    });
  });

  it("averages the middle two for even-length 4+ source data", () => {
    expect(aggregateValues([100, 110, 130, 500])).toEqual({
      valueRp: 120,
      minRp: 100,
      maxRp: 500,
      sourceCount: 4,
    });
  });

  it("works regardless of input ordering", () => {
    expect(aggregateValues([500, 110, 100]).valueRp).toBe(110);
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
