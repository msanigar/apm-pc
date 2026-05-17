import type { Confidence } from "./types";

export type AggregatedValue = {
  valueRp: number;
  minRp: number;
  maxRp: number;
  sourceCount: number;
};

/**
 * Aggregate a list of RP values from different sources into a single point
 * estimate plus min/max.
 *
 * - With 3+ sources we use the median to reject single-source outliers.
 * - With 1 or 2 sources we use the mean.
 *
 * Throws if `values` is empty; the caller must filter empty input out.
 */
export function aggregateValues(values: number[]): AggregatedValue {
  if (values.length === 0) {
    throw new Error("aggregateValues: no values to aggregate");
  }

  const sorted = [...values].sort((a, b) => a - b);
  const minRp = sorted[0];
  const maxRp = sorted[sorted.length - 1];

  let valueRp: number;
  if (sorted.length >= 3) {
    const middle = Math.floor(sorted.length / 2);
    valueRp =
      sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
  } else {
    valueRp = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  }

  return {
    valueRp,
    minRp,
    maxRp,
    sourceCount: values.length,
  };
}

/**
 * Map a source count + spread to a confidence label.
 *
 * Rules:
 *   - 0 sources → "low"
 *   - 1 source → "low"
 *   - 2 sources → "medium" if spread <= 20%, else "low"
 *   - 3+ sources → "high" if spread <= 15%, "medium" if <= 30%, else "low"
 */
export function confidenceFor(
  sourceCount: number,
  minRp: number,
  maxRp: number
): Confidence {
  if (sourceCount <= 1) return "low";

  const spread = maxRp === 0 ? 0 : (maxRp - minRp) / Math.max(maxRp, 1);

  if (sourceCount === 2) {
    return spread <= 0.2 ? "medium" : "low";
  }

  if (spread <= 0.15) return "high";
  if (spread <= 0.3) return "medium";
  return "low";
}
