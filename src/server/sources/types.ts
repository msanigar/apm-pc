import type { RawSourceValue } from "../../shared/normalize";

/**
 * Source adapters are responsible for fetching values from a single external
 * source and returning them in a canonical shape. Adapters MUST:
 *
 *   - Never run during user-facing requests (only inside the scheduled job).
 *   - Be resilient: throw on hard failure, but return an empty array for
 *     "source returned nothing useful today" — the validation step decides
 *     whether that's OK overall.
 */
export type SourceAdapter = {
  /** Stable identifier persisted in source_values.source_name. */
  name: string;
  /** Human-readable label for logs / debugging. */
  description: string;
  fetchValues: () => Promise<RawSourceValue[]>;
};
