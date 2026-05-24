import {
  buildAliasMap,
  buildCandidateDataset,
  normalizeSourceValues,
} from "../shared/normalize";
import type { RawSourceValue } from "../shared/normalize";
import type { ImportRunStatus } from "../shared/types";
import {
  diffDatasets,
  selectRowsForDeltaPromotion,
  splitSafeAndSuspiciousRows,
  validateCandidateDataset,
} from "../shared/validate";
import type { CandidateDataset, CandidateRow } from "../shared/types";
import { cacheImagesForRows, type CacheImagesOptions } from "./images";
import {
  completeImportRun,
  createImportRun,
  loadLiveDataset,
  promoteCandidateRows,
  recordSourceValues,
  replaceEggHatchData,
  replaceItemContentsData,
  saveValidationIssues,
  storeSuspiciousCandidates,
  upsertItems,
  type ItemUpsert,
} from "./repo";
import { getEnabledAdapters, type SourceAdapter } from "./sources";
import { MOCK_FIXTURES } from "./sources/mockFixtures";
import { fetchFandomEggs, fetchFandomGifts } from "./sources/fandomWiki";
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

/** Log every N image jobs during sync so long backfills don't look hung. */
const IMAGE_PROGRESS_EVERY = 25;

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function beginSyncPhase(label: string): { end: (detail?: string) => void } {
  const started = Date.now();
  console.info(`[sync] ${label}…`);
  return {
    end(detail?: string) {
      const suffix = detail ? ` — ${detail}` : "";
      console.info(`[sync] ${label} done (${formatElapsed(Date.now() - started)})${suffix}`);
    },
  };
}

function imageProgressLogger(): NonNullable<CacheImagesOptions["onProgress"]> {
  return ({ done, total, slug, status }) => {
    if (done !== 1 && done !== total && done % IMAGE_PROGRESS_EVERY !== 0) return;
    console.info(`[sync] images ${done}/${total} — ${slug} (${status})`);
  };
}

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
    console.info(
      `[sync] run ${importRun.id} started — ${adapters.length} adapter(s): ${adapters.map((a) => a.name).join(", ")}`
    );

    const fetchPhase = beginSyncPhase("fetch sources");
    const sourceResults = await Promise.allSettled(
      adapters.map(async (a) => {
        const adapterPhase = beginSyncPhase(`  ${a.name}`);
        try {
          const values = await a.fetchValues();
          adapterPhase.end(`${values.length} rows`);
          return { name: a.name, values };
        } catch (err) {
          adapterPhase.end("failed");
          throw err;
        }
      })
    );
    fetchPhase.end();

    const raw: RawSourceValue[] = [];
    const successfulSourceNames = new Set<string>();
    const adapterStats: Array<{
      name: string;
      rows: number;
      uniqueItems: number;
      status: "ok" | "failed";
    }> = [];

    for (let i = 0; i < sourceResults.length; i++) {
      const result = sourceResults[i];
      const adapterName = adapters[i]?.name ?? "unknown";
      if (result.status === "fulfilled") {
        const { values } = result.value;
        successfulSourceNames.add(adapterName);
        for (const v of values) raw.push(v);
        const uniqueItems = new Set(values.map((v) => v.sourceItemName)).size;
        adapterStats.push({
          name: adapterName,
          rows: values.length,
          uniqueItems,
          status: "ok",
        });
        if (values.length === 0) {
          console.warn(
            `[sync] adapter "${adapterName}" returned 0 rows — upstream may be down or blocking us`
          );
        }
      } else {
        console.warn(`[sync] adapter "${adapterName}" failed:`, result.reason);
        adapterStats.push({
          name: adapterName,
          rows: 0,
          uniqueItems: 0,
          status: "failed",
        });
      }
    }

    console.info("[sync] adapter stats:", JSON.stringify(adapterStats));

    const normalizePhase = beginSyncPhase("normalize & build candidate");
    // Build the alias map from our catalog so sources that use shortened
    // names or alternate spellings collapse onto the same canonical slug.
    const aliasMap = buildAliasMap(MOCK_FIXTURES);
    const normalized = normalizeSourceValues(raw, aliasMap);
    const candidate = buildCandidateDataset(normalized);

    // Collect per-slug metadata from raw rows so we don't lose the source's
    // category / rarity / display name / image URL when an item isn't in
    // MOCK_FIXTURES. Last writer wins, but we prefer non-"other" categories.
    const slugMeta = collectSlugMetadata(normalized, raw);
    normalizePhase.end(
      `${candidate.rows.length} variant rows, ${slugMeta.size} slugs`
    );

    const livePhase = beginSyncPhase("load live dataset");
    const live = dryRun
      ? { rows: [] }
      : await loadLiveDataset();
    livePhase.end(`${live.rows.length} live variant rows`);

    const validatePhase = beginSyncPhase("diff & validate");
    const diff = diffDatasets(live, candidate);
    const validation = validateCandidateDataset(live, candidate, diff);
    validatePhase.end(
      `fatal=${validation.fatal} suspicious=${validation.suspiciousKeys.size} ` +
        `new=${diff.candidateOnly.length} missing=${diff.liveOnly.length}`
    );

    if (dryRun) {
      const deltaRows = validation.fatal
        ? selectRowsForDeltaPromotion(candidate, diff, validation)
        : [];
      console.info(
        `[sync:dry-run] candidate=${candidate.rows.length} live=${live.rows.length} fatal=${validation.fatal} suspicious=${validation.suspiciousKeys.size} deltaRows=${deltaRows.length}`
      );
      console.info("[sync:dry-run] adapter stats:", JSON.stringify(adapterStats));
      return {
        status: validation.fatal
          ? deltaRows.length > 0
            ? "partial"
            : "rejected"
          : "promoted",
        sourceCount: successfulSourceNames.size,
        itemCount: candidate.rows.length,
        promotedCount: validation.fatal ? deltaRows.length : candidate.rows.length,
        heldBackCount: validation.suspiciousKeys.size,
        suspiciousCount: validation.suspiciousKeys.size,
        missingCount: diff.liveOnly.length,
        notes: validation.summary,
        dryRun: true,
      };
    }

    // 1. Upsert items first so we have IDs for everything in the candidate.
    const itemUpserts = buildItemUpserts(
      candidate.rows.map((r) => r.itemSlug),
      slugMeta
    );
    const itemsPhase = beginSyncPhase("upsert items");
    const slugToId = await upsertItems(itemUpserts);
    itemsPhase.end(`${slugToId.size} items`);

    // 2. Persist validation issues.
    const issuesPhase = beginSyncPhase("save validation issues");
    await saveValidationIssues(importRun.id, validation.issues, slugToId);
    issuesPhase.end(`${validation.issues.length} issues`);

    if (validation.fatal) {
      console.warn(`[sync] validation fatal — ${validation.summary}`);
      const deltaRows = selectRowsForDeltaPromotion(
        candidate,
        diff,
        validation
      );
      console.info(
        `[sync] delta promotion: ${deltaRows.length} candidate-only row(s)`
      );
      const { promotedCount, heldBackCount } = await promoteDeltaRows({
        deltaRows,
        candidate,
        validation,
        slugToId,
        slugMeta,
        now,
      });

      const deltaNote =
        deltaRows.length > 0
          ? `; Delta promote: ${promotedCount}/${deltaRows.length} rows (held ${heldBackCount})`
          : "";
      const adapterNote = `; Adapters: ${adapterStats
        .map((a) => `${a.name}=${a.uniqueItems}`)
        .join(", ")}`;
      const notes = validation.summary + deltaNote + adapterNote;
      const status = promotedCount > 0 ? "partial" : "rejected";

      await completeImportRun(importRun.id, {
        status,
        sourceCount: successfulSourceNames.size,
        itemCount: candidate.rows.length,
        promotedCount,
        heldBackCount,
        suspiciousCount: validation.suspiciousKeys.size,
        missingCount: diff.liveOnly.length,
        notes,
      });

      if (promotedCount > 0) {
        console.info(
          `[sync] fatal checks failed but promoted ${promotedCount} delta rows`
        );
      }

      return {
        status,
        runId: importRun.id,
        sourceCount: successfulSourceNames.size,
        itemCount: candidate.rows.length,
        promotedCount,
        heldBackCount,
        suspiciousCount: validation.suspiciousKeys.size,
        missingCount: diff.liveOnly.length,
        notes,
        dryRun: false,
      };
    }

    const { safeRows, heldBackRows } = splitSafeAndSuspiciousRows(
      candidate,
      validation
    );
    console.info(
      `[sync] promote: ${safeRows.length} safe, ${heldBackRows.length} held back (suspicious)`
    );

    // 3. Promote safe rows, hold back suspicious ones.
    const promotePhase = beginSyncPhase("promote aggregated values");
    const promotedCount = await promoteCandidateRows(safeRows, slugToId, now);
    promotePhase.end(`${promotedCount} row(s)`);

    const suspiciousPhase = beginSyncPhase("store suspicious candidates");
    const heldBackCount = await storeSuspiciousCandidates(
      heldBackRows,
      slugToId,
      now
    );
    suspiciousPhase.end(`${heldBackCount} row(s)`);

    // 4. Always log raw per-source values for future debugging.
    const sourceValuesPhase = beginSyncPhase("record source values");
    await recordSourceValues(candidate.rows, slugToId, now);
    sourceValuesPhase.end(`${candidate.rows.length} candidate row(s)`);

    // 5. Cache any source-provided images for the rows we accepted. The
    //    helper is idempotent and only fetches when `items.image_path` is
    //    still NULL, so re-runs don't re-download anything.
    const imageUrls = buildImageUrlMap(slugMeta);
    const imageJobCount = new Set(safeRows.map((r) => r.itemSlug)).size;
    const imagesPhase = beginSyncPhase(
      `cache images (up to ${imageJobCount} slugs, ${imageUrls.size} URLs available)`
    );
    const imageResult = await cacheImagesForRows(safeRows, imageUrls, {
      onProgress: imageProgressLogger(),
    });
    imagesPhase.end(
      `uploaded=${imageResult.uploaded} skipped_present=${imageResult.skippedAlreadyCached} ` +
        `skipped_missing=${imageResult.skippedMissingItem} errors=${imageResult.errors}`
    );

    // 6. Refresh wiki-sourced relationship data, gated by env. Failures
    //    here are logged but never affect the main run's status — values
    //    are the primary deliverable.
    //
    //    NOTE: pet acquisition data (Cerberus, Bat Dragon, …) is NOT run
    //    inside the daily sync because it walks ~1500 wiki pages and
    //    would exceed scheduled-function time limits. Run it explicitly
    //    via `npm run sync:wiki` (see `scripts/syncWiki.ts`).
    if (isFandomEggsEnabled()) {
      const eggsPhase = beginSyncPhase("refresh fandom eggs");
      try {
        const payload = await fetchFandomEggs();
        const result = await replaceEggHatchData({
          odds: payload.odds.map((o) => ({
            eggSlug: o.eggSlug,
            rarity: o.rarity,
            probabilityPct: o.probabilityPct,
            source: o.source,
            sourceRevisionId: o.sourceRevisionId,
            fetchedAt: payload.fetchedAt,
          })),
          pets: payload.pets.map((p) => ({
            eggSlug: p.eggSlug,
            petSlug: p.petSlug,
            petDisplayName: p.petDisplayName,
            rarity: p.rarity,
            source: p.source,
            sourceRevisionId: p.sourceRevisionId,
            fetchedAt: payload.fetchedAt,
          })),
        });
        eggsPhase.end(
          `${result.oddsCount} odds, ${result.petsCount} pets ` +
            `(eggs=${payload.eggCount})`
        );
      } catch (err) {
        eggsPhase.end("failed");
        console.warn("[sync] fandom egg refresh failed:", err);
      }
    }

    if (isFandomGiftsEnabled()) {
      const giftsPhase = beginSyncPhase("refresh fandom gifts");
      try {
        const payload = await fetchFandomGifts();
        const result = await replaceItemContentsData({
          items: payload.items.map((i) => ({
            containerSlug: i.giftSlug,
            containedSlug: i.itemSlug,
            containedDisplayName: i.itemDisplayName,
            rarity: i.rarity,
            categoryHint: i.categoryHint,
            dropChancePct: i.chancePct,
            source: i.source,
            sourceRevisionId: i.sourceRevisionId,
            fetchedAt: payload.fetchedAt,
          })),
          odds: payload.oddsByGift.map((o) => ({
            eggSlug: o.eggSlug,
            rarity: o.rarity,
            probabilityPct: o.probabilityPct,
            source: o.source,
            sourceRevisionId: o.sourceRevisionId,
            fetchedAt: payload.fetchedAt,
          })),
        });
        giftsPhase.end(
          `${result.itemsCount} items, ${result.oddsCount} odds (gifts=${payload.giftCount})`
        );
      } catch (err) {
        giftsPhase.end("failed");
        console.warn("[sync] fandom gift refresh failed:", err);
      }
    }

    const status: ImportRunStatus = heldBackRows.length > 0 ? "partial" : "promoted";
    console.info(`[sync] finishing run ${importRun.id} — status=${status}`);
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
 * Per-slug metadata harvested from raw source rows. Used to fill in the
 * canonical item record for items we don't have in `MOCK_FIXTURES` yet.
 */
type SlugMeta = {
  name?: string;
  category?: import("../shared/types").ItemCategory;
  rarity?: string | null;
  isHighTier?: boolean;
  imageUrl?: string;
};

function collectSlugMetadata(
  normalized: ReturnType<typeof normalizeSourceValues>,
  raw: RawSourceValue[]
): Map<string, SlugMeta> {
  const meta = new Map<string, SlugMeta>();

  // Build a sourceItemName → itemSlug index from the normalized list. Raw
  // rows don't carry the slug, but normalized rows do.
  const nameToSlug = new Map<string, string>();
  for (const n of normalized) {
    nameToSlug.set(n.sourceItemName, n.itemSlug);
    if (!meta.has(n.itemSlug)) {
      meta.set(n.itemSlug, { name: n.itemName, category: n.category });
    }
  }

  for (const r of raw) {
    const slug = nameToSlug.get(r.sourceItemName);
    if (!slug) continue;
    const existing = meta.get(slug) ?? {};
    // Prefer a non-"other" category if one source supplied a real one.
    if (
      r.category &&
      r.category !== "other" &&
      (!existing.category || existing.category === "other")
    ) {
      existing.category = r.category;
    }
    // Rarity: pick the highest tier any source claims for this slug.
    // Sources sometimes disagree (e.g. a "rare" variant entry vs the
    // canonical "legendary" rarity). Adopt Me's rarity is intrinsic to
    // the pet, not its variant, so the max is the right answer.
    // Adapters tunnel rarity through `confidence` on RawSourceValue.
    if (
      r.confidence &&
      /^(common|uncommon|rare|ultra[- ]?rare|legendary)$/i.test(r.confidence)
    ) {
      const incoming = r.confidence.toLowerCase().replace(/-/g, " ");
      if (rarityRank(incoming) > rarityRank(existing.rarity)) {
        existing.rarity = incoming;
      }
      if (existing.rarity === "legendary") existing.isHighTier = true;
    }
    // Use the first image URL we see.
    if (r.imageUrl && !existing.imageUrl) existing.imageUrl = r.imageUrl;
    meta.set(slug, existing);
  }

  return meta;
}

/**
 * Look up canonical metadata (name, category, rarity, isHighTier, aliases) for
 * a list of slugs. Prefers `MOCK_FIXTURES` (hand-curated) for known items;
 * falls back to per-slug metadata harvested from this run's source values
 * for everything else. Last-resort fallback is the slug-derived display
 * name with category="other".
 */
function buildItemUpserts(
  slugs: string[],
  slugMeta: Map<string, SlugMeta> = new Map()
): ItemUpsert[] {
  const unique = Array.from(new Set(slugs));
  const out: ItemUpsert[] = [];
  for (const slug of unique) {
    const fixture = MOCK_FIXTURES.find((m) => m.slug === slug);
    const meta = slugMeta.get(slug);

    // Fixture provides hand-tuned name/aliases/isHighTier. Source meta
    // supplies category and rarity for everything not in the fixture, and
    // also UPGRADES the fixture when the fixture's category is "other" or
    // its rarity is unset (which happens for items added by previous catalog
    // dumps that didn't have source-derived metadata yet).
    const name = fixture?.name ?? meta?.name ?? titleCaseFromSlug(slug);
    const aliases = fixture?.aliases ?? [];

    let category = fixture?.category ?? meta?.category ?? "other";
    if (category === "other" && meta?.category && meta.category !== "other") {
      category = meta.category;
    }

    const rarity = fixture?.rarity ?? meta?.rarity ?? null;
    const isHighTier =
      fixture?.isHighTier === true ||
      meta?.isHighTier === true ||
      (rarity?.toLowerCase() === "legendary");

    out.push({ slug, name, category, rarity, aliases, isHighTier });
  }
  return out;
}

function buildImageUrlMap(slugMeta: Map<string, SlugMeta>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [slug, meta] of slugMeta) {
    if (meta.imageUrl) out.set(slug, meta.imageUrl);
  }
  return out;
}

const RARITY_ORDER = [
  "common",
  "uncommon",
  "rare",
  "ultra rare",
  "legendary",
] as const;

function rarityRank(rarity: string | null | undefined): number {
  if (!rarity) return -1;
  const idx = RARITY_ORDER.indexOf(rarity as (typeof RARITY_ORDER)[number]);
  return idx;
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function isFandomEggsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const v = env.ENABLE_FANDOM_EGGS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isFandomGiftsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const v = env.ENABLE_FANDOM_GIFTS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Promote a subset of candidate rows after dataset-wide validation failed.
 * Used for incomplete upstream fetches so new catalog entries still land.
 */
async function promoteDeltaRows(input: {
  deltaRows: CandidateRow[];
  candidate: CandidateDataset;
  validation: ReturnType<typeof validateCandidateDataset>;
  slugToId: Map<string, string>;
  slugMeta: Map<string, SlugMeta>;
  now: Date;
}): Promise<{ promotedCount: number; heldBackCount: number }> {
  const { deltaRows, candidate, validation, slugToId, slugMeta, now } = input;
  if (deltaRows.length === 0) {
    return { promotedCount: 0, heldBackCount: 0 };
  }

  const deltaDataset: CandidateDataset = {
    rows: deltaRows,
    sourceNames: candidate.sourceNames,
  };
  const { safeRows, heldBackRows } = splitSafeAndSuspiciousRows(
    deltaDataset,
    validation
  );
  console.info(
    `[sync] delta: ${safeRows.length} safe, ${heldBackRows.length} held back`
  );

  const promotePhase = beginSyncPhase("delta promote aggregated values");
  const promotedCount = await promoteCandidateRows(safeRows, slugToId, now);
  promotePhase.end(`${promotedCount} row(s)`);

  const suspiciousPhase = beginSyncPhase("delta store suspicious candidates");
  const heldBackCount = await storeSuspiciousCandidates(
    heldBackRows,
    slugToId,
    now
  );
  suspiciousPhase.end(`${heldBackCount} row(s)`);

  const sourceValuesPhase = beginSyncPhase("delta record source values");
  await recordSourceValues(deltaRows, slugToId, now);
  sourceValuesPhase.end(`${deltaRows.length} row(s)`);

  const imageUrls = buildImageUrlMap(slugMeta);
  const imagesPhase = beginSyncPhase("delta cache images");
  const imageResult = await cacheImagesForRows(safeRows, imageUrls, {
    onProgress: imageProgressLogger(),
  });
  imagesPhase.end(
    `uploaded=${imageResult.uploaded} skipped_present=${imageResult.skippedAlreadyCached} errors=${imageResult.errors}`
  );

  return { promotedCount, heldBackCount };
}

// Re-exports kept handy for callers
export { toSlug };
