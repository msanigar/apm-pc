import type {
  CandidateDataset,
  CandidateRow,
  LiveDataset,
  LiveRow,
  Variant,
} from "./types";

/**
 * Validation thresholds. Tunable; persisted here as a single source of truth
 * so tests and runtime stay in sync.
 */
export const VALIDATION_RULES = {
  /** Max % change allowed on a normal item before we hold the new value back. */
  maxSingleItemChangePercent: 25,
  /** Max % change allowed on a high-tier item. Tighter than normal items. */
  maxHighTierItemChangePercent: 15,
  /** Max % change in the median value across the whole dataset. */
  maxDatasetMedianChangePercent: 5,
  /** Max % of items whose value moved past the per-item threshold. */
  maxItemsChangedOverThresholdPercent: 10,
  /** Min % of live items that must also appear in the candidate. */
  minExpectedItemCoveragePercent: 90,
  /** Min average source coverage relative to the live dataset's average. */
  minExpectedSourceCoveragePercent: 66,
} as const;

export type ValidationSeverity = "info" | "warn" | "fatal";

export type ValidationIssueType =
  | "single_item_swing"
  | "high_tier_item_swing"
  | "missing_item"
  | "new_item"
  | "low_source_count"
  | "dataset_median_shift"
  | "too_many_items_changed"
  | "too_few_items"
  | "source_coverage_dropped";

export type ValidationIssue = {
  itemSlug?: string;
  variant?: Variant;
  issueType: ValidationIssueType;
  severity: ValidationSeverity;
  oldValueRp?: number | null;
  newValueRp?: number | null;
  percentChange?: number | null;
  message: string;
};

export type ValidationSummary = {
  issues: ValidationIssue[];
  /** Slugs+variants whose candidate value must be held back as suspicious. */
  suspiciousKeys: Set<string>;
  /** True if the dataset as a whole is too broken to promote anything. */
  fatal: boolean;
  /** Human-readable summary persisted on the import_runs row. */
  summary: string;
};

export type DatasetDiff = {
  liveOnly: LiveRow[];
  candidateOnly: CandidateRow[];
  common: Array<{
    live: LiveRow;
    candidate: CandidateRow;
    candidateValueRp: number;
    percentChange: number;
  }>;
};

export function keyOf(itemSlug: string, variant: Variant): string {
  return `${itemSlug}::${variant}`;
}

/**
 * Build the per-row diff between the live dataset and the candidate. The
 * candidate value used for comparison is the median (3+) or mean (1-2) of the
 * source values, mirroring `aggregateValues`.
 */
export function diffDatasets(
  live: LiveDataset,
  candidate: CandidateDataset
): DatasetDiff {
  const liveMap = new Map<string, LiveRow>();
  for (const row of live.rows) liveMap.set(keyOf(row.itemSlug, row.variant), row);

  const candidateMap = new Map<string, CandidateRow>();
  for (const row of candidate.rows)
    candidateMap.set(keyOf(row.itemSlug, row.variant), row);

  const common: DatasetDiff["common"] = [];
  const candidateOnly: CandidateRow[] = [];

  for (const cand of candidate.rows) {
    const key = keyOf(cand.itemSlug, cand.variant);
    const liveRow = liveMap.get(key);
    if (!liveRow) {
      candidateOnly.push(cand);
      continue;
    }
    const candidateValue = summariseCandidateValue(cand);
    const oldValue = liveRow.valueRp;
    const percentChange =
      oldValue === 0
        ? candidateValue === 0
          ? 0
          : Number.POSITIVE_INFINITY
        : ((candidateValue - oldValue) / oldValue) * 100;
    common.push({
      live: liveRow,
      candidate: cand,
      candidateValueRp: candidateValue,
      percentChange,
    });
  }

  const liveOnly: LiveRow[] = [];
  for (const liveRow of live.rows) {
    if (!candidateMap.has(keyOf(liveRow.itemSlug, liveRow.variant))) {
      liveOnly.push(liveRow);
    }
  }

  return { liveOnly, candidateOnly, common };
}

/**
 * Mirror of aggregate.ts's logic, kept inline to keep this file dependency-free
 * for testing. Median for 3+, mean otherwise.
 */
function summariseCandidateValue(row: CandidateRow): number {
  if (row.values.length === 0) return 0;
  const sorted = [...row.values].sort((a, b) => a - b);
  if (sorted.length >= 3) {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }
  return sorted.reduce((a, b) => a + b, 0) / sorted.length;
}

/**
 * Run validation against a freshly built diff and produce a list of issues
 * plus the set of (itemSlug, variant) keys whose candidate value should be
 * held back as "suspicious".
 */
export function validateCandidateDataset(
  live: LiveDataset,
  candidate: CandidateDataset,
  diff: DatasetDiff
): ValidationSummary {
  const issues: ValidationIssue[] = [];
  const suspicious = new Set<string>();

  for (const entry of diff.common) {
    const isHigh = entry.live.isHighTier === true;
    const threshold = isHigh
      ? VALIDATION_RULES.maxHighTierItemChangePercent
      : VALIDATION_RULES.maxSingleItemChangePercent;

    if (Math.abs(entry.percentChange) > threshold) {
      const key = keyOf(entry.live.itemSlug, entry.live.variant);
      suspicious.add(key);
      issues.push({
        itemSlug: entry.live.itemSlug,
        variant: entry.live.variant,
        issueType: isHigh ? "high_tier_item_swing" : "single_item_swing",
        severity: "warn",
        oldValueRp: entry.live.valueRp,
        newValueRp: entry.candidateValueRp,
        percentChange: entry.percentChange,
        message: `${entry.live.itemSlug} (${entry.live.variant}) changed by ${round(
          entry.percentChange
        )}% (threshold ${threshold}%)`,
      });
    }

    const candSourceCount = entry.candidate.values.length;
    if (candSourceCount < entry.live.sourceCount && candSourceCount <= 1) {
      issues.push({
        itemSlug: entry.live.itemSlug,
        variant: entry.live.variant,
        issueType: "low_source_count",
        severity: "info",
        message: `${entry.live.itemSlug} (${entry.live.variant}) dropped from ${entry.live.sourceCount} → ${candSourceCount} sources`,
      });
    }
  }

  for (const liveRow of diff.liveOnly) {
    issues.push({
      itemSlug: liveRow.itemSlug,
      variant: liveRow.variant,
      issueType: "missing_item",
      severity: "info",
      oldValueRp: liveRow.valueRp,
      message: `${liveRow.itemSlug} (${liveRow.variant}) missing from candidate`,
    });
  }

  for (const cand of diff.candidateOnly) {
    issues.push({
      itemSlug: cand.itemSlug,
      variant: cand.variant,
      issueType: "new_item",
      severity: "info",
      message: `${cand.itemSlug} (${cand.variant}) is new`,
    });
  }

  // -- Dataset-wide fatal checks ------------------------------------------------

  let fatal = false;
  const fatalReasons: string[] = [];

  // Item coverage: how many live rows are present in the candidate?
  if (live.rows.length > 0) {
    const coveredCount = diff.common.length;
    const coveragePercent = (coveredCount / live.rows.length) * 100;
    if (coveragePercent < VALIDATION_RULES.minExpectedItemCoveragePercent) {
      const message = `Candidate covers only ${round(coveragePercent)}% of live items (min ${
        VALIDATION_RULES.minExpectedItemCoveragePercent
      }%)`;
      issues.push({
        issueType: "too_few_items",
        severity: "fatal",
        message,
      });
      fatal = true;
      fatalReasons.push(message);
    }
  }

  // % of common rows that moved past the per-item threshold.
  if (diff.common.length > 0) {
    const moved = diff.common.filter((c) => {
      const isHigh = c.live.isHighTier === true;
      const threshold = isHigh
        ? VALIDATION_RULES.maxHighTierItemChangePercent
        : VALIDATION_RULES.maxSingleItemChangePercent;
      return Math.abs(c.percentChange) > threshold;
    });
    const movedPercent = (moved.length / diff.common.length) * 100;
    if (movedPercent > VALIDATION_RULES.maxItemsChangedOverThresholdPercent) {
      const message = `${round(movedPercent)}% of items moved beyond their threshold (max ${
        VALIDATION_RULES.maxItemsChangedOverThresholdPercent
      }%)`;
      issues.push({
        issueType: "too_many_items_changed",
        severity: "fatal",
        message,
      });
      fatal = true;
      fatalReasons.push(message);
    }
  }

  // Dataset-wide median shift.
  if (diff.common.length > 0) {
    const liveMedian = median(diff.common.map((c) => c.live.valueRp));
    const candMedian = median(diff.common.map((c) => c.candidateValueRp));
    if (liveMedian > 0) {
      const medianShift = ((candMedian - liveMedian) / liveMedian) * 100;
      if (
        Math.abs(medianShift) > VALIDATION_RULES.maxDatasetMedianChangePercent
      ) {
        const message = `Dataset median shifted by ${round(medianShift)}% (max ${
          VALIDATION_RULES.maxDatasetMedianChangePercent
        }%)`;
        issues.push({
          issueType: "dataset_median_shift",
          severity: "fatal",
          message,
        });
        fatal = true;
        fatalReasons.push(message);
      }
    }
  }

  // Average source coverage vs the live dataset.
  if (diff.common.length > 0) {
    const liveAvgSources =
      diff.common.reduce((a, c) => a + c.live.sourceCount, 0) /
      diff.common.length;
    const candAvgSources =
      diff.common.reduce((a, c) => a + c.candidate.values.length, 0) /
      diff.common.length;
    if (liveAvgSources > 0) {
      const coverage = (candAvgSources / liveAvgSources) * 100;
      if (coverage < VALIDATION_RULES.minExpectedSourceCoveragePercent) {
        const message = `Avg source coverage fell to ${round(coverage)}% of live (min ${
          VALIDATION_RULES.minExpectedSourceCoveragePercent
        }%)`;
        issues.push({
          issueType: "source_coverage_dropped",
          severity: "fatal",
          message,
        });
        fatal = true;
        fatalReasons.push(message);
      }
    }
  }

  // If no live dataset exists yet (first import), nothing is "suspicious" by
  // definition — everything is new.
  if (live.rows.length === 0) {
    suspicious.clear();
  }

  const summary = fatal
    ? `Rejected: ${fatalReasons.join("; ")}`
    : suspicious.size > 0
      ? `Partial: ${suspicious.size} suspicious rows held back`
      : `Clean import: ${candidate.rows.length} rows, ${issues.length} info issues`;

  return { issues, suspiciousKeys: suspicious, fatal, summary };
}

/**
 * Split a candidate dataset into rows that are safe to promote vs rows that
 * should be held back because of the validation step.
 */
export function splitSafeAndSuspiciousRows(
  candidate: CandidateDataset,
  validation: ValidationSummary
): { safeRows: CandidateRow[]; heldBackRows: CandidateRow[] } {
  const safe: CandidateRow[] = [];
  const held: CandidateRow[] = [];
  for (const row of candidate.rows) {
    if (validation.suspiciousKeys.has(keyOf(row.itemSlug, row.variant))) {
      held.push(row);
    } else {
      safe.push(row);
    }
  }
  return { safeRows: safe, heldBackRows: held };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[m - 1] + sorted[m]) / 2
    : sorted[m];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
