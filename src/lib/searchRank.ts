import type { FuseResult } from "fuse.js";
import type { SearchIndexItem, Variant } from "@shared/types";

/**
 * Sort Fuse hits for display. Text relevance (lower Fuse score = better match)
 * always wins; variant value is only a tie-breaker when the user asked for a
 * specific variant (e.g. "neon cow" → search "cow", highlight neon values).
 */
export function sortFuseHits(
  hits: FuseResult<SearchIndexItem>[],
  requestedVariant?: Variant
): SearchIndexItem[] {
  if (!requestedVariant) {
    return hits.map((h) => h.item);
  }

  return [...hits]
    .sort((a, b) => {
      const scoreA = a.score ?? 1;
      const scoreB = b.score ?? 1;
      if (scoreA !== scoreB) return scoreA - scoreB;

      const av = a.item.values[requestedVariant]?.valueRp;
      const bv = b.item.values[requestedVariant]?.valueRp;
      if (av != null && bv != null) return bv - av;
      if (av != null) return -1;
      if (bv != null) return 1;
      return 0;
    })
    .map((h) => h.item);
}
