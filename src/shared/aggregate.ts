import type { Confidence } from "./types";

export type AggregatedValue = {
  valueRp: number;
  minRp: number;
  maxRp: number;
  /** Number of sources kept after outlier rejection. */
  sourceCount: number;
  /** Number of source values rejected as outliers, if any. */
  outlierCount: number;
};

/**
 * If a value is this many times bigger or smaller than the median, we assume
 * the source had a unit-mismatch / typo / "0" placeholder and drop it from
 * the aggregation. Chosen empirically: real per-source disagreement on a
 * single variant rarely exceeds 2-3x; anything >5x is almost always a bug
 * (e.g. AMVerse's Bat Dragon "regular" value of 0.12 vs AMTV's 550, where
 * AMVerse appears to be in a different unit for that one row).
 */
const OUTLIER_RATIO = 5;

/**
 * Aggregate a list of RP values from different sources into a single point
 * estimate plus min/max.
 *
 * - With 1 or 2 sources we use the mean directly (no outlier rejection —
 *   we have no majority to vote against).
 * - With 3+ sources we compute the median first, drop any values outside
 *   [median / OUTLIER_RATIO, median * OUTLIER_RATIO], then recompute the
 *   median and min/max from the cleaned set.
 *
 * Throws if `values` is empty; the caller must filter empty input out.
 */
export function aggregateValues(values: number[]): AggregatedValue {
  if (values.length === 0) {
    throw new Error("aggregateValues: no values to aggregate");
  }

  if (values.length < 3) {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      valueRp: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      minRp: sorted[0],
      maxRp: sorted[sorted.length - 1],
      sourceCount: sorted.length,
      outlierCount: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rawMedian = median(sorted);

  // Outlier rejection only kicks in when the median is large enough to
  // make a ratio test meaningful — for tiny numbers like 0.012, "5x off"
  // is still 0.06, which is well within source disagreement.
  const cleaned =
    rawMedian > 0.5
      ? sorted.filter(
          (v) =>
            v >= rawMedian / OUTLIER_RATIO && v <= rawMedian * OUTLIER_RATIO
        )
      : sorted;

  // Safety: if outlier rejection somehow removed everything, fall back to
  // the raw set rather than throwing.
  const kept = cleaned.length > 0 ? cleaned : sorted;

  return {
    valueRp: median(kept),
    minRp: kept[0],
    maxRp: kept[kept.length - 1],
    sourceCount: kept.length,
    outlierCount: sorted.length - kept.length,
  };
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
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
