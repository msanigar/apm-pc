import {
  buildAliasMap,
  buildCandidateDataset,
  normalizeSourceValues,
} from "../shared/normalize";
import type { RawSourceValue } from "../shared/normalize";
import type { ImportRunStatus } from "../shared/types";
import {
  diffDatasets,
  splitSafeAndSuspiciousRows,
  validateCandidateDataset,
} from "../shared/validate";
import { cacheImagesForRows } from "./images";
import {
  completeImportRun,
  createImportRun,
  loadLiveDataset,
  promoteCandidateRows,
  recordSourceValues,
  saveValidationIssues,
  storeSuspiciousCandidates,
  upsertItems,
  type ItemUpsert,
} from "./repo";
import { getEnabledAdapters, type SourceAdapter } from "./sources";
import { MOCK_FIXTURES } from "./sources/mockFixtures";
import { toSlug } from "../shared/slug";
import { hasSupabaseAdmin } from "./supabase";

export type SyncReport = {
  status: ImportRunStatus;
  runId?: string;
  sourceCount: number;
  itemCount: number;
  promotedCount: number;
  heldBackCount: number;
  suspiciousCount: number;
  missingCount: number;
  notes: string;
  /** True if we never actually wrote anything (e.g. no Supabase configured). */
  dryRun: boolean;
};

export type SyncOptions = {
  adapters?: SourceAdapter[];
  now?: Date;
};

/**
 * The canonical daily sync. Called by the Netlify scheduled function and by
 * `npm run sync:local`.
 *
 * Steps mirror the spec:
 *   1. Open import_runs row.
 *   2. Fetch from all adapters in parallel (`allSettled`).
 *   3. Normalise + group into candidate dataset.
 *   4. Load live dataset.
 *   5. Diff + validate.
 *   6. If fatal → mark rejected, return.
 *   7. Split safe vs suspicious.
 *   8. Upsert items so we always have rows for new things.
 *   9. Promote safe rows, store suspicious candidates, record raw sources.
 *  10. Cache images.
 *  11. Close import_runs row with the right status.
 */
export async function syncValues(options: SyncOptions = {}): Promise<SyncReport> {
  const now = options.now ?? new Date();
  const adapters = options.adapters ?? getEnabledAdapters();
  const dryRun = !hasSupabaseAdmin();

  if (adapters.length === 0) {
    return {
      status: "failed",
      sourceCount: 0,
      itemCount: 0,
      promotedCount: 0,
      heldBackCount: 0,
      suspiciousCount: 0,
      missingCount: 0,
      notes: "No source adapters enabled.",
      dryRun,
    };
  }

  // Always create an import run when DB is configured; in dry-run we just log.
  const importRun = dryRun
    ? { id: "dry-run", startedAt: now }
    : await createImportRun();

  try {
    const sourceResults = await Promise.allSettled(
      adapters.map(async (a) => {
        const values = await a.fetchValues();
        return { adapter: a, values };
      })
    );

    const raw: RawSourceValue[] = [];
    const successfulSourceNames = new Set<string>();
    for (const result of sourceResults) {
      if (result.status === "fulfilled") {
        successfulSourceNames.add(result.value.adapter.name);
        for (const v of result.value.values) raw.push(v);
      } else {
        console.warn("[sync] adapter failed:", result.reason);
      }
    }

    // Build the alias map from our catalog so sources that use shortened
    // names or alternate spellings collapse onto the same canonical slug.
    const aliasMap = buildAliasMap(MOCK_FIXTURES);
    const normalized = normalizeSourceValues(raw, aliasMap);
    const candidate = buildCandidateDataset(normalized);

    const live = dryRun
      ? { rows: [] }
      : await loadLiveDataset();

    const diff = diffDatasets(live, candidate);
    const validation = validateCandidateDataset(live, candidate, diff);

    if (dryRun) {
      console.info(
        `[sync:dry-run] candidate=${candidate.rows.length} live=${live.rows.length} fatal=${validation.fatal} suspicious=${validation.suspiciousKeys.size}`
      );
      return {
        status: validation.fatal ? "rejected" : "promoted",
        sourceCount: successfulSourceNames.size,
        itemCount: candidate.rows.length,
        promotedCount: validation.fatal ? 0 : candidate.rows.length,
        heldBackCount: validation.suspiciousKeys.size,
        suspiciousCount: validation.suspiciousKeys.size,
        missingCount: diff.liveOnly.length,
        notes: validation.summary,
        dryRun: true,
      };
    }

    // 1. Upsert items first so we have IDs for everything in the candidate.
    const itemUpserts = buildItemUpserts(candidate.rows.map((r) => r.itemSlug));
    const slugToId = await upsertItems(itemUpserts);

    // 2. Persist validation issues.
    await saveValidationIssues(importRun.id, validation.issues, slugToId);

    if (validation.fatal) {
      await completeImportRun(importRun.id, {
        status: "rejected",
        sourceCount: successfulSourceNames.size,
        itemCount: candidate.rows.length,
        missingCount: diff.liveOnly.length,
        notes: validation.summary,
      });
      return {
        status: "rejected",
        runId: importRun.id,
        sourceCount: successfulSourceNames.size,
        itemCount: candidate.rows.length,
        promotedCount: 0,
        heldBackCount: 0,
        suspiciousCount: validation.suspiciousKeys.size,
        missingCount: diff.liveOnly.length,
        notes: validation.summary,
        dryRun: false,
      };
    }

    const { safeRows, heldBackRows } = splitSafeAndSuspiciousRows(
      candidate,
      validation
    );

    // 3. Promote safe rows, hold back suspicious ones.
    const promotedCount = await promoteCandidateRows(safeRows, slugToId, now);
    const heldBackCount = await storeSuspiciousCandidates(
      heldBackRows,
      slugToId,
      now
    );

    // 4. Always log raw per-source values for future debugging.
    await recordSourceValues(candidate.rows, slugToId, now);

    // 5. Cache any source-provided images for the rows we accepted.
    const imageUrls = buildImageUrlMap();
    await cacheImagesForRows(safeRows, imageUrls);

    const status: ImportRunStatus = heldBackRows.length > 0 ? "partial" : "promoted";
    await completeImportRun(importRun.id, {
      status,
      sourceCount: successfulSourceNames.size,
      itemCount: candidate.rows.length,
      promotedCount,
      heldBackCount,
      suspiciousCount: validation.suspiciousKeys.size,
      missingCount: diff.liveOnly.length,
      notes: validation.summary,
    });

    return {
      status,
      runId: importRun.id,
      sourceCount: successfulSourceNames.size,
      itemCount: candidate.rows.length,
      promotedCount,
      heldBackCount,
      suspiciousCount: validation.suspiciousKeys.size,
      missingCount: diff.liveOnly.length,
      notes: validation.summary,
      dryRun: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!dryRun) {
      try {
        await completeImportRun(importRun.id, {
          status: "failed",
          notes: message.slice(0, 500),
        });
      } catch {
        // ignore: we already failed, don't shadow the original error
      }
    }
    throw error;
  }
}

/**
 * Look up canonical metadata (name, category, rarity, isHighTier, aliases) for
 * a list of slugs. We currently use the in-memory fixtures as the
 * source-of-truth catalog. When we add a real catalog adapter, this is the
 * place to plug it in.
 */
function buildItemUpserts(slugs: string[]): ItemUpsert[] {
  const unique = Array.from(new Set(slugs));
  const out: ItemUpsert[] = [];
  for (const slug of unique) {
    const fixture = MOCK_FIXTURES.find((m) => m.slug === slug);
    if (fixture) {
      out.push({
        slug: fixture.slug,
        name: fixture.name,
        category: fixture.category,
        rarity: fixture.rarity ?? null,
        aliases: fixture.aliases ?? [],
        isHighTier: fixture.isHighTier ?? false,
      });
    } else {
      // Unknown item: still upsert it so users can see it, just with minimal
      // metadata.
      const name = titleCaseFromSlug(slug);
      out.push({
        slug,
        name,
        category: "other",
        aliases: [],
        isHighTier: false,
      });
    }
  }
  return out;
}

function buildImageUrlMap(): Map<string, string> {
  // Hook for when adapters start emitting `imageUrl` consistently. For now
  // the mock adapters don't, so this returns an empty map.
  return new Map<string, string>();
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// Re-exports kept handy for callers
export { toSlug };
