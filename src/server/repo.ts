import type {
  AcquisitionKind,
  AggregatedVariantValue,
  CandidateRow,
  ContainedIn,
  EggHatchOdds,
  EggHatchPet,
  HatchedFromEgg,
  HatchRarity,
  ImportRunStatus,
  ImportRunSummary,
  Item,
  ItemCategory,
  ItemContent,
  LiveDataset,
  LiveRow,
  PetAcquisition,
  SearchIndexItem,
  Variant,
} from "../shared/types";
import { aggregateValues, confidenceFor } from "../shared/aggregate";
import { variantsForCategory } from "../shared/variants";
import { publicImageUrl } from "./images";
import { requireSupabaseAdmin } from "./supabase";
import { MOCK_FIXTURES } from "./sources/mockFixtures";
import { toSlug } from "../shared/slug";
import type { ValidationIssue } from "../shared/validate";

/**
 * Tiny repository layer over Supabase. Keeps SQL in one place so the Netlify
 * Functions stay thin.
 */

/**
 * Max rows per Supabase insert/upsert request. PostgREST defaults cap the
 * request body around ~1 MB; with ~150 bytes per row that translates to a
 * safe ceiling well below 1000. We pick 500 so even a wide row (lots of
 * columns or long aliases) still fits comfortably.
 */
const PG_BULK_CHUNK = 500;

/**
 * Generic chunked insert/upsert. Returns the count of payload rows the
 * caller passed in (Supabase doesn't reliably echo back inserted counts for
 * large batches, and we don't need them).
 */
async function bulkInsert<T extends Record<string, unknown>>(
  table: string,
  payload: T[],
  options?: { upsert?: boolean; onConflict?: string; ignoreDuplicates?: boolean }
): Promise<number> {
  if (payload.length === 0) return 0;
  const db = requireSupabaseAdmin();
  for (let i = 0; i < payload.length; i += PG_BULK_CHUNK) {
    const chunk = payload.slice(i, i + PG_BULK_CHUNK);
    // Supabase's generated insert/upsert types are very strict about excess
    // properties and we're feeding heterogeneous row shapes from several
    // tables through this helper, so cast to a loose record shape.
    const query = db.from(table) as unknown as {
      insert: (rows: unknown) => Promise<{ error: unknown }>;
      upsert: (
        rows: unknown,
        opts: { onConflict?: string; ignoreDuplicates?: boolean }
      ) => Promise<{ error: unknown }>;
    };
    const { error } = options?.upsert
      ? await query.upsert(chunk, {
          onConflict: options.onConflict,
          ignoreDuplicates: options.ignoreDuplicates ?? false,
        })
      : await query.insert(chunk);
    if (error) throw error;
  }
  return payload.length;
}

export type ItemUpsert = {
  slug: string;
  name: string;
  category: ItemCategory;
  rarity?: string | null;
  aliases?: string[];
  isHighTier?: boolean;
  /** Omit to leave `items.image_path` unchanged on conflict. */
  imagePath?: string | null;
};

export async function loadLiveDataset(): Promise<LiveDataset> {
  const db = requireSupabaseAdmin();
  const { data, error } = await db
    .from("aggregated_values")
    .select(
      "variant, value_rp, source_count, is_suspicious, last_accepted_at, item:items(slug, is_high_tier)"
    );
  if (error) throw error;
  const rows: LiveRow[] = (data ?? [])
    .filter((row: any) => row.item?.slug)
    .map((row: any) => ({
      itemSlug: row.item.slug as string,
      variant: row.variant as Variant,
      valueRp: Number(row.value_rp),
      sourceCount: Number(row.source_count),
      isSuspicious: Boolean(row.is_suspicious),
      lastAcceptedAt: row.last_accepted_at,
      isHighTier: Boolean(row.item.is_high_tier),
    }));
  return { rows };
}

export async function upsertItems(items: ItemUpsert[]): Promise<Map<string, string>> {
  if (items.length === 0) return new Map();
  const db = requireSupabaseAdmin();
  // Omit `image_path` unless the caller sets `imagePath` — daily sync only
  // updates catalog metadata; images are written by `cacheImagesForSlugs`.
  const payload = items.map((i) => {
    const row: Record<string, unknown> = {
      slug: i.slug,
      name: i.name,
      category: i.category,
      rarity: i.rarity ?? null,
      aliases: i.aliases ?? [],
      is_high_tier: i.isHighTier ?? false,
      updated_at: new Date().toISOString(),
    };
    if (i.imagePath !== undefined) {
      row.image_path = i.imagePath;
    }
    return row;
  });
  const map = new Map<string, string>();
  // Upsert in chunks; we still need ids back, so we issue a SELECT after.
  for (let i = 0; i < payload.length; i += PG_BULK_CHUNK) {
    const chunk = payload.slice(i, i + PG_BULK_CHUNK);
    const { data, error } = await db
      .from("items")
      .upsert(chunk, { onConflict: "slug" })
      .select("id, slug");
    if (error) throw error;
    for (const row of data ?? []) map.set(row.slug as string, row.id as string);
  }
  return map;
}

export async function promoteCandidateRows(
  rows: CandidateRow[],
  slugToId: Map<string, string>,
  now: Date = new Date()
): Promise<number> {
  if (rows.length === 0) return 0;

  const payload = rows
    .map((r) => {
      const itemId = slugToId.get(r.itemSlug);
      if (!itemId) return null;
      const agg = aggregateValues(r.values);
      const conf = confidenceFor(agg.sourceCount, agg.minRp, agg.maxRp);
      return {
        item_id: itemId,
        variant: r.variant,
        value_rp: agg.valueRp,
        min_rp: agg.minRp,
        max_rp: agg.maxRp,
        source_count: agg.sourceCount,
        confidence: conf,
        is_suspicious: false,
        last_accepted_at: now.toISOString(),
        last_candidate_value_rp: agg.valueRp,
        last_candidate_at: now.toISOString(),
        calculated_at: now.toISOString(),
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  return bulkInsert("aggregated_values", payload, {
    upsert: true,
    onConflict: "item_id,variant",
  });
}

function aggregatedKey(itemId: string, variant: string): string {
  return `${itemId}::${variant}`;
}

type ExistingAggregatedRow = {
  valueRp: number;
  minRp: number | null;
  maxRp: number | null;
  sourceCount: number;
  confidence: string;
  lastAcceptedAt: string | null;
};

/** Live aggregated rows keyed by `item_id::variant`. */
async function loadExistingAggregatedRows(
  itemIds: string[]
): Promise<Map<string, ExistingAggregatedRow>> {
  if (itemIds.length === 0) return new Map();

  const db = requireSupabaseAdmin();
  const map = new Map<string, ExistingAggregatedRow>();
  const uniqueIds = [...new Set(itemIds)];

  for (let i = 0; i < uniqueIds.length; i += PG_BULK_CHUNK) {
    const chunk = uniqueIds.slice(i, i + PG_BULK_CHUNK);
    const { data, error } = await db
      .from("aggregated_values")
      .select(
        "item_id, variant, value_rp, min_rp, max_rp, source_count, confidence, last_accepted_at"
      )
      .in("item_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      map.set(
        aggregatedKey(row.item_id as string, row.variant as string),
        {
          valueRp: Number(row.value_rp),
          minRp: row.min_rp != null ? Number(row.min_rp) : null,
          maxRp: row.max_rp != null ? Number(row.max_rp) : null,
          sourceCount: Number(row.source_count),
          confidence: row.confidence as string,
          lastAcceptedAt: (row.last_accepted_at as string | null) ?? null,
        }
      );
    }
  }
  return map;
}

/**
 * For rows held back by validation, record the candidate alongside the live
 * value (which we keep) so an operator can see exactly what we rejected.
 */
export async function storeSuspiciousCandidates(
  rows: CandidateRow[],
  slugToId: Map<string, string>,
  now: Date = new Date()
): Promise<number> {
  if (rows.length === 0) return 0;

  const itemIds: string[] = [];
  const prepared: Array<{
    itemId: string;
    variant: string;
    agg: ReturnType<typeof aggregateValues>;
    conf: ReturnType<typeof confidenceFor>;
  }> = [];

  for (const r of rows) {
    const itemId = slugToId.get(r.itemSlug);
    if (!itemId) continue;
    const agg = aggregateValues(r.values);
    prepared.push({
      itemId,
      variant: r.variant,
      agg,
      conf: confidenceFor(agg.sourceCount, agg.minRp, agg.maxRp),
    });
    itemIds.push(itemId);
  }

  const existing = await loadExistingAggregatedRows(itemIds);

  const updatePayload: Record<string, unknown>[] = [];
  const insertPayload: Record<string, unknown>[] = [];

  for (const { itemId, variant, agg, conf } of prepared) {
    const key = aggregatedKey(itemId, variant);
    const live = existing.get(key);
    if (live) {
      // Upsert replaces omitted columns with null — carry forward live values.
      updatePayload.push({
        item_id: itemId,
        variant,
        value_rp: live.valueRp,
        min_rp: live.minRp,
        max_rp: live.maxRp,
        source_count: live.sourceCount,
        confidence: live.confidence,
        last_accepted_at: live.lastAcceptedAt,
        last_candidate_value_rp: agg.valueRp,
        last_candidate_at: now.toISOString(),
        is_suspicious: true,
        calculated_at: now.toISOString(),
      });
    } else {
      // No live row yet — insert must satisfy NOT NULL columns.
      insertPayload.push({
        item_id: itemId,
        variant,
        value_rp: agg.valueRp,
        min_rp: agg.minRp,
        max_rp: agg.maxRp,
        source_count: agg.sourceCount,
        confidence: conf,
        is_suspicious: true,
        last_candidate_value_rp: agg.valueRp,
        last_candidate_at: now.toISOString(),
        calculated_at: now.toISOString(),
      });
    }
  }

  let count = 0;
  if (updatePayload.length > 0) {
    count += await bulkInsert("aggregated_values", updatePayload, {
      upsert: true,
      onConflict: "item_id,variant",
    });
  }
  if (insertPayload.length > 0) {
    count += await bulkInsert("aggregated_values", insertPayload, {
      upsert: true,
      onConflict: "item_id,variant",
    });
  }
  return count;
}

export async function recordSourceValues(
  rows: CandidateRow[],
  slugToId: Map<string, string>,
  now: Date = new Date()
): Promise<number> {
  if (rows.length === 0) return 0;
  const payload: Record<string, unknown>[] = [];
  for (const r of rows) {
    const itemId = slugToId.get(r.itemSlug);
    if (!itemId) continue;
    for (let i = 0; i < r.values.length; i++) {
      payload.push({
        item_id: itemId,
        variant: r.variant,
        source_name: r.sources[i],
        value_rp: r.values[i],
        fetched_at: now.toISOString(),
      });
    }
  }
  return bulkInsert("source_values", payload);
}

export async function createImportRun(): Promise<{ id: string; startedAt: Date }> {
  const db = requireSupabaseAdmin();
  const startedAt = new Date();
  const { data, error } = await db
    .from("import_runs")
    .insert({ status: "running", started_at: startedAt.toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string, startedAt };
}

export async function completeImportRun(
  runId: string,
  patch: {
    status: ImportRunStatus;
    sourceCount?: number;
    itemCount?: number;
    promotedCount?: number;
    heldBackCount?: number;
    suspiciousCount?: number;
    missingCount?: number;
    notes?: string;
  }
): Promise<void> {
  const db = requireSupabaseAdmin();
  const { error } = await db
    .from("import_runs")
    .update({
      completed_at: new Date().toISOString(),
      status: patch.status,
      source_count: patch.sourceCount ?? null,
      item_count: patch.itemCount ?? null,
      promoted_count: patch.promotedCount ?? 0,
      held_back_count: patch.heldBackCount ?? 0,
      suspicious_count: patch.suspiciousCount ?? 0,
      missing_count: patch.missingCount ?? 0,
      notes: patch.notes ?? null,
    })
    .eq("id", runId);
  if (error) throw error;
}

export async function saveValidationIssues(
  runId: string,
  issues: ValidationIssue[],
  slugToId: Map<string, string>
): Promise<void> {
  if (issues.length === 0) return;
  const payload = issues.map((i) => ({
    import_run_id: runId,
    item_id: i.itemSlug ? slugToId.get(i.itemSlug) ?? null : null,
    variant: i.variant ?? null,
    issue_type: i.issueType,
    old_value_rp: i.oldValueRp ?? null,
    new_value_rp: i.newValueRp ?? null,
    percent_change: i.percentChange ?? null,
    severity: i.severity,
  }));
  await bulkInsert("import_validation_issues", payload);
}

export async function getLatestImportRun(): Promise<ImportRunSummary | null> {
  const db = requireSupabaseAdmin();
  const { data, error } = await db
    .from("import_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    startedAt: data.started_at as string,
    completedAt: data.completed_at as string | null,
    status: data.status as ImportRunStatus,
    sourceCount: data.source_count as number | null,
    itemCount: data.item_count as number | null,
    promotedCount: Number(data.promoted_count ?? 0),
    heldBackCount: Number(data.held_back_count ?? 0),
    suspiciousCount: Number(data.suspicious_count ?? 0),
    missingCount: Number(data.missing_count ?? 0),
    notes: (data.notes as string | null) ?? null,
  };
}

// ---------- Read paths for the public API -----------------------------------

export async function loadSearchIndex(): Promise<SearchIndexItem[]> {
  const db = requireSupabaseAdmin();

  // Items table can hold tens of thousands of rows. Page in 1000-row
  // chunks (PostgREST's default cap) to avoid silent truncation.
  const items: any[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("items")
      .select(
        "id, slug, name, category, rarity, aliases, image_path, is_high_tier"
      )
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    items.push(...data);
    if (data.length < PAGE) break;
  }
  if (items.length === 0) return [];

  // Aggregated values: same pagination concern, plus PostgREST URL-length
  // limits on the `in(item_id, …)` clause once the id list grows past a few
  // hundred. Chunk both the id filter and the row range.
  const byItem = new Map<string, AggregatedVariantValue[]>();
  const ID_CHUNK = 200;
  for (let i = 0; i < items.length; i += ID_CHUNK) {
    const chunk = items.slice(i, i + ID_CHUNK).map((it) => it.id as string);
    let offset = 0;
    while (true) {
      const { data: aggs, error: aggErr } = await db
        .from("aggregated_values")
        .select(
          "item_id, variant, value_rp, min_rp, max_rp, source_count, confidence, is_suspicious, last_accepted_at, last_candidate_value_rp, last_candidate_at, calculated_at"
        )
        .in("item_id", chunk)
        .range(offset, offset + PAGE - 1);
      if (aggErr) throw aggErr;
      if (!aggs || aggs.length === 0) break;
      for (const a of aggs) {
        const arr = byItem.get(a.item_id as string) ?? [];
        arr.push(mapAggregated(a));
        byItem.set(a.item_id as string, arr);
      }
      if (aggs.length < PAGE) break;
      offset += PAGE;
    }
  }

  return items.map((i: any) => buildSearchIndexItem(i, byItem.get(i.id) ?? []));
}

export async function loadItemBySlug(slug: string): Promise<{
  item: Item;
  values: AggregatedVariantValue[];
  hatchesInto?: {
    odds: EggHatchOdds[];
    pets: EggHatchPet[];
    fetchedAt: string | null;
    source: string | null;
  };
  hatchesFrom?: HatchedFromEgg[];
  acquisitions?: PetAcquisition[];
  contents?: {
    items: ItemContent[];
    odds: EggHatchOdds[];
    fetchedAt: string | null;
    source: string | null;
  };
  containedIn?: ContainedIn[];
} | null> {
  const db = requireSupabaseAdmin();
  const { data: item, error } = await db
    .from("items")
    .select("id, slug, name, category, rarity, aliases, image_path, is_high_tier")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!item) return null;
  const { data: aggs, error: aggErr } = await db
    .from("aggregated_values")
    .select(
      "variant, value_rp, min_rp, max_rp, source_count, confidence, is_suspicious, last_accepted_at, last_candidate_value_rp, last_candidate_at, calculated_at"
    )
    .eq("item_id", item.id);
  if (aggErr) throw aggErr;

  const category = (item as any).category as ItemCategory;
  const itemId = item.id as string;

  // Side-channel: pull category-specific relations. Each branch catches
  // its own errors so a relation-table issue never breaks the value page
  // that worked perfectly fine before this feature shipped.
  let hatchesInto: Awaited<ReturnType<typeof loadHatchesIntoForEgg>> | undefined;
  let hatchesFrom: HatchedFromEgg[] | undefined;
  let acquisitions: PetAcquisition[] | undefined;
  let contents:
    | Awaited<ReturnType<typeof loadContentsForContainer>>
    | undefined;
  let containedIn: ContainedIn[] | undefined;

  try {
    if (category === "egg") {
      hatchesInto = await loadHatchesIntoForEgg(itemId);
      if (hatchesInto.odds.length === 0 && hatchesInto.pets.length === 0) {
        hatchesInto = undefined;
      }
    } else if (category === "pet") {
      const eggs = await loadHatchedFromForPet(itemId);
      if (eggs.length > 0) hatchesFrom = eggs;
      const acqs = await loadAcquisitionsForPet(itemId);
      if (acqs.length > 0) acquisitions = acqs;
    }
  } catch (err) {
    console.warn(`[repo] hatch lookup for ${slug} failed:`, err);
  }

  // Container check: relevant for items that ARE containers. We can't
  // tell from category alone (some boxes may be misclassified), so we
  // always attempt the lookup and only attach when non-empty.
  try {
    if (category === "gift" || category === "other") {
      const c = await loadContentsForContainer(itemId);
      if (c.items.length > 0) contents = c;
    }
  } catch (err) {
    console.warn(`[repo] contents lookup for ${slug} failed:`, err);
  }

  // Reverse "contained in" — useful for any item that might appear inside
  // a box (RGB Sword on the RGB-Sword page shows "Obtained from RGB
  // Reward Box"). Skip for containers themselves to avoid duplication.
  try {
    if (category !== "gift") {
      const back = await loadContainedInForItem(itemId);
      if (back.length > 0) containedIn = back;
    }
  } catch (err) {
    console.warn(`[repo] containedIn lookup for ${slug} failed:`, err);
  }

  return {
    item: mapItem(item),
    values: (aggs ?? []).map(mapAggregated),
    hatchesInto,
    hatchesFrom,
    acquisitions,
    contents,
    containedIn,
  };
}

function mapItem(row: any): Item {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    category: row.category as ItemCategory,
    rarity: (row.rarity as string | null) ?? null,
    aliases: (row.aliases as string[] | null) ?? [],
    imagePath: (row.image_path as string | null) ?? null,
    isHighTier: Boolean(row.is_high_tier),
  };
}

function mapAggregated(row: any): AggregatedVariantValue {
  return {
    variant: row.variant as Variant,
    valueRp: Number(row.value_rp),
    minRp: row.min_rp != null ? Number(row.min_rp) : null,
    maxRp: row.max_rp != null ? Number(row.max_rp) : null,
    sourceCount: Number(row.source_count),
    confidence: row.confidence as AggregatedVariantValue["confidence"],
    isSuspicious: Boolean(row.is_suspicious),
    lastAcceptedAt: row.last_accepted_at as string | null,
    lastCandidateValueRp:
      row.last_candidate_value_rp != null
        ? Number(row.last_candidate_value_rp)
        : null,
    lastCandidateAt: row.last_candidate_at as string | null,
    calculatedAt: row.calculated_at as string,
  };
}

function buildSearchIndexItem(
  itemRow: any,
  aggs: AggregatedVariantValue[]
): SearchIndexItem {
  const values: SearchIndexItem["values"] = {};
  for (const v of aggs) values[v.variant] = v;
  return {
    id: itemRow.id as string,
    slug: itemRow.slug as string,
    name: itemRow.name as string,
    category: itemRow.category as ItemCategory,
    rarity: (itemRow.rarity as string | null) ?? null,
    aliases: (itemRow.aliases as string[] | null) ?? [],
    isHighTier: Boolean(itemRow.is_high_tier),
    imageUrl: publicImageUrl(itemRow.image_path),
    values,
  };
}

/**
 * In-memory fallback used when Supabase env vars are not configured (e.g. the
 * first time someone runs `npm run dev:netlify`). It walks the same mock
 * fixtures the adapters use and aggregates them with a fake "1 source" so the
 * UI has something to render.
 */
/* ─────────────────── Egg hatching data ─────────────────── */

export type EggHatchOddsUpsert = {
  eggSlug: string;
  rarity: HatchRarity;
  probabilityPct: number | null;
  source: string;
  sourceRevisionId: string | null;
  fetchedAt: string;
};

export type EggHatchPetUpsert = {
  eggSlug: string;
  petSlug: string;
  petDisplayName: string;
  rarity: HatchRarity;
  source: string;
  sourceRevisionId: string | null;
  fetchedAt: string;
};

export type ReplaceHatchDataResult = {
  oddsCount: number;
  petsCount: number;
  unmatchedEggSlugs: string[];
  unresolvedPetSlugs: string[];
};

/**
 * Replace the hatch dataset for every egg the adapter just emitted.
 *
 * For each affected `egg_id`, we DELETE existing rows from the same `source`
 * and then INSERT the new rows. This way pet/rarity changes (additions AND
 * removals) propagate cleanly on every sync.
 *
 * Items not in our catalog are skipped:
 *   - Eggs that don't resolve to an `items.id` are recorded in `unmatchedEggSlugs`.
 *   - Pets that don't resolve are kept (with `pet_id = null` + a snapshot slug)
 *     so the wiki's hatch list still renders; their slugs are reported in
 *     `unresolvedPetSlugs` for visibility.
 */
export async function replaceEggHatchData(input: {
  odds: EggHatchOddsUpsert[];
  pets: EggHatchPetUpsert[];
}): Promise<ReplaceHatchDataResult> {
  const db = requireSupabaseAdmin();

  // Build the slug → item-id map once. We need it for both eggs and pets.
  const slugToId = await loadAllItemSlugIds();

  const unmatchedEggSlugs = new Set<string>();
  const unresolvedPetSlugs = new Set<string>();

  // Group affected eggs/sources so we can delete in bulk.
  const affectedEggIdsBySource = new Map<string, Set<string>>();
  function noteAffected(eggId: string, source: string) {
    let set = affectedEggIdsBySource.get(source);
    if (!set) {
      set = new Set();
      affectedEggIdsBySource.set(source, set);
    }
    set.add(eggId);
  }

  const oddsPayload: Record<string, unknown>[] = [];
  for (const row of input.odds) {
    const eggId = slugToId.get(row.eggSlug);
    if (!eggId) {
      unmatchedEggSlugs.add(row.eggSlug);
      continue;
    }
    noteAffected(eggId, row.source);
    oddsPayload.push({
      egg_id: eggId,
      rarity: row.rarity,
      probability_pct: row.probabilityPct,
      source: row.source,
      source_revision_id: row.sourceRevisionId,
      fetched_at: row.fetchedAt,
    });
  }

  const petsPayload: Record<string, unknown>[] = [];
  for (const row of input.pets) {
    const eggId = slugToId.get(row.eggSlug);
    if (!eggId) {
      unmatchedEggSlugs.add(row.eggSlug);
      continue;
    }
    const petId = slugToId.get(row.petSlug) ?? null;
    if (petId == null) unresolvedPetSlugs.add(row.petSlug);
    noteAffected(eggId, row.source);
    petsPayload.push({
      egg_id: eggId,
      pet_id: petId,
      pet_slug_snapshot: petId == null ? row.petSlug : null,
      pet_display_name: row.petDisplayName,
      rarity: row.rarity,
      source: row.source,
      source_revision_id: row.sourceRevisionId,
      fetched_at: row.fetchedAt,
    });
  }

  // Delete existing rows for every (egg, source) pair we're about to refresh.
  for (const [source, eggIds] of affectedEggIdsBySource) {
    const ids = Array.from(eggIds);
    // PostgREST `.in()` lists are practically limited to ~300 items; chunk.
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      const oddsDel = await db
        .from("egg_hatch_odds")
        .delete()
        .eq("source", source)
        .in("egg_id", chunk);
      if (oddsDel.error) throw oddsDel.error;
      const petsDel = await db
        .from("egg_hatch_pets")
        .delete()
        .eq("source", source)
        .in("egg_id", chunk);
      if (petsDel.error) throw petsDel.error;
    }
  }

  const oddsCount = await bulkInsert("egg_hatch_odds", oddsPayload);
  const petsCount = await bulkInsert("egg_hatch_pets", petsPayload);

  return {
    oddsCount,
    petsCount,
    unmatchedEggSlugs: Array.from(unmatchedEggSlugs),
    unresolvedPetSlugs: Array.from(unresolvedPetSlugs),
  };
}

/**
 * Page through `items` to build a slug → id map. Used by the hatch sync to
 * resolve egg/pet slugs after the value sync has upserted everything.
 */
export async function loadAllItemSlugIds(): Promise<Map<string, string>> {
  const db = requireSupabaseAdmin();
  const map = new Map<string, string>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("items")
      .select("id, slug")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) map.set(row.slug as string, row.id as string);
    if (data.length < PAGE) break;
  }
  return map;
}

/**
 * Fetch the "Hatches into" payload for an egg item — the per-tier odds plus
 * the pet roster (with pet display name + slug + image where available).
 */
export async function loadHatchesIntoForEgg(eggId: string): Promise<{
  odds: EggHatchOdds[];
  pets: EggHatchPet[];
  fetchedAt: string | null;
  source: string | null;
}> {
  const db = requireSupabaseAdmin();

  const [oddsRes, petsRes] = await Promise.all([
    db
      .from("egg_hatch_odds")
      .select("rarity, probability_pct, source, fetched_at")
      .eq("egg_id", eggId),
    db
      .from("egg_hatch_pets")
      .select(
        // `egg_hatch_pets` has two FKs to `items` (egg_id, pet_id) so the
        // embed name must be disambiguated; otherwise PostgREST throws
        // PGRST300 and the whole hatch payload comes back empty.
        "rarity, pet_slug_snapshot, pet_display_name, source, fetched_at, pet:items!pet_id(slug, name, image_path)"
      )
      .eq("egg_id", eggId),
  ]);
  if (oddsRes.error) throw oddsRes.error;
  if (petsRes.error) throw petsRes.error;

  const odds: EggHatchOdds[] = (oddsRes.data ?? []).map((row: any) => ({
    rarity: row.rarity as HatchRarity,
    probabilityPct: row.probability_pct != null ? Number(row.probability_pct) : null,
  }));

  const pets: EggHatchPet[] = (petsRes.data ?? []).map((row: any) => {
    const linked = row.pet ?? null;
    return {
      petSlug: (linked?.slug as string) ?? null,
      petName:
        (linked?.name as string) ??
        (row.pet_display_name as string | null) ??
        (row.pet_slug_snapshot as string | null) ??
        "Unknown pet",
      rarity: row.rarity as HatchRarity,
      imageUrl: publicImageUrl(linked?.image_path ?? null),
    };
  });

  const fetchedAt = pickNewestTimestamp([
    ...(oddsRes.data ?? []).map((r: any) => r.fetched_at),
    ...(petsRes.data ?? []).map((r: any) => r.fetched_at),
  ]);
  const source =
    (oddsRes.data?.[0] as any)?.source ?? (petsRes.data?.[0] as any)?.source ?? null;

  return { odds: orderOddsByTier(odds), pets, fetchedAt, source };
}

/**
 * Reverse lookup: for a pet item, list the eggs that hatch it and the
 * rarity tier in each.
 */
export async function loadHatchedFromForPet(petId: string): Promise<HatchedFromEgg[]> {
  const db = requireSupabaseAdmin();
  const { data, error } = await db
    .from("egg_hatch_pets")
    // Disambiguate the embed: `egg_hatch_pets` FKs to `items` twice.
    .select("rarity, egg:items!egg_id(slug, name)")
    .eq("pet_id", petId);
  if (error) throw error;
  const out: HatchedFromEgg[] = [];
  for (const row of (data ?? []) as any[]) {
    if (!row.egg?.slug) continue;
    out.push({
      eggSlug: row.egg.slug as string,
      eggName: (row.egg.name as string) ?? (row.egg.slug as string),
      rarity: row.rarity as HatchRarity,
    });
  }
  // Stable sort by egg name for predictable UI.
  return out.sort((a, b) => a.eggName.localeCompare(b.eggName));
}

const TIER_ORDER: Record<HatchRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  ultra_rare: 3,
  legendary: 4,
};

function orderOddsByTier(rows: EggHatchOdds[]): EggHatchOdds[] {
  return [...rows].sort((a, b) => TIER_ORDER[a.rarity] - TIER_ORDER[b.rarity]);
}

function pickNewestTimestamp(stamps: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const s of stamps) {
    if (!s) continue;
    if (best == null || s > best) best = s;
  }
  return best;
}

/* ─────────────────── Pet acquisitions (events, Robux, …) ─────────────────── */

export type PetAcquisitionUpsert = {
  petSlug: string;
  kind: AcquisitionKind;
  eventName: string | null;
  eventYear: number | null;
  currency: string | null;
  cost: number | null;
  retired: boolean;
  releasedAt: string | null;
  notes: string | null;
  source: string;
  sourceRevisionId: string | null;
  fetchedAt: string;
};

export type ReplaceAcquisitionsResult = {
  inserted: number;
  unresolvedPetSlugs: string[];
};

/**
 * Same pattern as `replaceEggHatchData`: collect every pet we got rows
 * for, delete existing rows for that (pet, source) pair, then insert.
 */
export async function replacePetAcquisitionsData(input: {
  rows: PetAcquisitionUpsert[];
}): Promise<ReplaceAcquisitionsResult> {
  const db = requireSupabaseAdmin();
  const slugToId = await loadAllItemSlugIds();

  const unresolvedPetSlugs = new Set<string>();
  const affectedPetIdsBySource = new Map<string, Set<string>>();
  function noteAffected(petId: string, source: string) {
    let set = affectedPetIdsBySource.get(source);
    if (!set) {
      set = new Set();
      affectedPetIdsBySource.set(source, set);
    }
    set.add(petId);
  }

  const payload: Record<string, unknown>[] = [];
  for (const row of input.rows) {
    const petId = slugToId.get(row.petSlug);
    if (!petId) {
      unresolvedPetSlugs.add(row.petSlug);
      continue;
    }
    noteAffected(petId, row.source);
    payload.push({
      pet_id: petId,
      kind: row.kind,
      event_name: row.eventName,
      event_year: row.eventYear,
      currency: row.currency,
      cost: row.cost,
      retired: row.retired,
      released_at: row.releasedAt,
      notes: row.notes,
      source: row.source,
      source_revision_id: row.sourceRevisionId,
      fetched_at: row.fetchedAt,
    });
  }

  // Replace pattern: delete existing rows for each affected (pet, source).
  for (const [source, petIds] of affectedPetIdsBySource) {
    const ids = Array.from(petIds);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      const del = await db
        .from("pet_acquisitions")
        .delete()
        .eq("source", source)
        .in("pet_id", chunk);
      if (del.error) throw del.error;
    }
  }

  const inserted = await bulkInsert("pet_acquisitions", payload);
  return {
    inserted,
    unresolvedPetSlugs: Array.from(unresolvedPetSlugs),
  };
}

export async function loadAcquisitionsForPet(
  petId: string
): Promise<PetAcquisition[]> {
  const db = requireSupabaseAdmin();
  const { data, error } = await db
    .from("pet_acquisitions")
    .select(
      "kind, event_name, event_year, currency, cost, retired, released_at, notes, source"
    )
    .eq("pet_id", petId);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    kind: row.kind as AcquisitionKind,
    eventName: (row.event_name as string | null) ?? null,
    eventYear: row.event_year != null ? Number(row.event_year) : null,
    currency: (row.currency as string | null) ?? null,
    cost: row.cost != null ? Number(row.cost) : null,
    retired: Boolean(row.retired),
    releasedAt: (row.released_at as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    source: row.source as string,
  }));
}

/* ─────────────────── Box / gift contents ─────────────────── */

export type ItemContentUpsert = {
  containerSlug: string;
  /** Resolved-or-not item slug from the wiki side of the relation. */
  containedSlug: string;
  containedDisplayName: string;
  rarity: HatchRarity | null;
  categoryHint: string | null;
  dropChancePct: number | null;
  source: string;
  sourceRevisionId: string | null;
  fetchedAt: string;
};

export type ReplaceContentsResult = {
  itemsCount: number;
  oddsCount: number;
  unmatchedContainerSlugs: string[];
  unresolvedItemSlugs: string[];
};

/**
 * Replace the contents listing for every container the adapter just
 * emitted. Mirrors `replaceEggHatchData` exactly:
 *   - DELETE existing rows from the same `source` for every affected
 *     container,
 *   - INSERT the fresh roster.
 *
 * Per-rarity odds from the same source live in `egg_hatch_odds` (we
 * reuse the table — it's the same shape). `containerSlug` becomes the
 * `egg_id` from the odds caller's perspective.
 */
export async function replaceItemContentsData(input: {
  items: ItemContentUpsert[];
  /** Optional per-rarity odds; reuses the egg_hatch_odds table. */
  odds: EggHatchOddsUpsert[];
}): Promise<ReplaceContentsResult> {
  const db = requireSupabaseAdmin();
  const slugToId = await loadAllItemSlugIds();

  const unmatchedContainerSlugs = new Set<string>();
  const unresolvedItemSlugs = new Set<string>();

  const affectedContainerIdsBySource = new Map<string, Set<string>>();
  function noteAffected(containerId: string, source: string) {
    let set = affectedContainerIdsBySource.get(source);
    if (!set) {
      set = new Set();
      affectedContainerIdsBySource.set(source, set);
    }
    set.add(containerId);
  }

  const itemsPayload: Record<string, unknown>[] = [];
  for (const row of input.items) {
    const containerId = slugToId.get(row.containerSlug);
    if (!containerId) {
      unmatchedContainerSlugs.add(row.containerSlug);
      continue;
    }
    const containedId = slugToId.get(row.containedSlug) ?? null;
    if (containedId == null) unresolvedItemSlugs.add(row.containedSlug);
    noteAffected(containerId, row.source);
    itemsPayload.push({
      container_id: containerId,
      contained_item_id: containedId,
      contained_slug_snapshot: containedId == null ? row.containedSlug : null,
      contained_display_name: row.containedDisplayName,
      rarity: row.rarity,
      category_hint: row.categoryHint,
      drop_chance: row.dropChancePct,
      quantity: 1,
      source: row.source,
      source_revision_id: row.sourceRevisionId,
      fetched_at: row.fetchedAt,
    });
  }

  // Odds — also stored under the container's id (the table is shared
  // with egg odds; `egg_id` is the abstract "parent container" id).
  const oddsPayload: Record<string, unknown>[] = [];
  for (const row of input.odds) {
    const containerId = slugToId.get(row.eggSlug);
    if (!containerId) {
      unmatchedContainerSlugs.add(row.eggSlug);
      continue;
    }
    noteAffected(containerId, row.source);
    oddsPayload.push({
      egg_id: containerId,
      rarity: row.rarity,
      probability_pct: row.probabilityPct,
      source: row.source,
      source_revision_id: row.sourceRevisionId,
      fetched_at: row.fetchedAt,
    });
  }

  // Delete existing rows for every (container, source) pair we're
  // about to refresh.
  for (const [source, containerIds] of affectedContainerIdsBySource) {
    const ids = Array.from(containerIds);
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      const itemsDel = await db
        .from("item_contents")
        .delete()
        .eq("source", source)
        .in("container_id", chunk);
      if (itemsDel.error) throw itemsDel.error;
      const oddsDel = await db
        .from("egg_hatch_odds")
        .delete()
        .eq("source", source)
        .in("egg_id", chunk);
      if (oddsDel.error) throw oddsDel.error;
    }
  }

  const itemsCount = await bulkInsert("item_contents", itemsPayload);
  const oddsCount = await bulkInsert("egg_hatch_odds", oddsPayload);

  return {
    itemsCount,
    oddsCount,
    unmatchedContainerSlugs: Array.from(unmatchedContainerSlugs),
    unresolvedItemSlugs: Array.from(unresolvedItemSlugs),
  };
}

export async function loadContentsForContainer(
  containerId: string
): Promise<{
  items: ItemContent[];
  odds: EggHatchOdds[];
  fetchedAt: string | null;
  source: string | null;
}> {
  const db = requireSupabaseAdmin();

  const [itemsRes, oddsRes] = await Promise.all([
    db
      .from("item_contents")
      .select(
        // FK disambiguation: `item_contents` references items twice
        // (container_id, contained_item_id). PostgREST needs the hint.
        "rarity, category_hint, drop_chance, quantity, contained_slug_snapshot, contained_display_name, source, fetched_at, contained:items!contained_item_id(slug, name, image_path)"
      )
      .eq("container_id", containerId),
    db
      .from("egg_hatch_odds")
      .select("rarity, probability_pct, source, fetched_at")
      .eq("egg_id", containerId),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (oddsRes.error) throw oddsRes.error;

  const items: ItemContent[] = (itemsRes.data ?? []).map((row: any) => {
    const linked = row.contained ?? null;
    return {
      containedSlug: (linked?.slug as string) ?? null,
      containedName:
        (linked?.name as string) ??
        (row.contained_display_name as string | null) ??
        (row.contained_slug_snapshot as string | null) ??
        "Unknown item",
      rarity: (row.rarity as HatchRarity | null) ?? null,
      categoryHint: (row.category_hint as string | null) ?? null,
      dropChancePct:
        row.drop_chance != null ? Number(row.drop_chance) : null,
      quantity: Number(row.quantity ?? 1),
      imageUrl: publicImageUrl(linked?.image_path ?? null),
    };
  });

  const odds: EggHatchOdds[] = (oddsRes.data ?? []).map((row: any) => ({
    rarity: row.rarity as HatchRarity,
    probabilityPct:
      row.probability_pct != null ? Number(row.probability_pct) : null,
  }));

  const fetchedAt = pickNewestTimestamp([
    ...(itemsRes.data ?? []).map((r: any) => r.fetched_at),
    ...(oddsRes.data ?? []).map((r: any) => r.fetched_at),
  ]);
  const source =
    (itemsRes.data?.[0] as any)?.source ??
    (oddsRes.data?.[0] as any)?.source ??
    null;

  return { items, odds: orderOddsByTier(odds), fetchedAt, source };
}

/**
 * Reverse lookup: every container that lists THIS item as part of its
 * contents. Used to show "Contained in {RGB Reward Box}" on item pages.
 */
export async function loadContainedInForItem(
  itemId: string
): Promise<ContainedIn[]> {
  const db = requireSupabaseAdmin();
  const { data, error } = await db
    .from("item_contents")
    .select(
      "drop_chance, container:items!container_id(slug, name, image_path)"
    )
    .eq("contained_item_id", itemId);
  if (error) throw error;
  const out: ContainedIn[] = [];
  for (const row of (data ?? []) as any[]) {
    if (!row.container?.slug) continue;
    out.push({
      containerSlug: row.container.slug as string,
      containerName:
        (row.container.name as string) ?? (row.container.slug as string),
      containerImageUrl: publicImageUrl(row.container.image_path ?? null),
      dropChancePct:
        row.drop_chance != null ? Number(row.drop_chance) : null,
    });
  }
  return out.sort((a, b) => a.containerName.localeCompare(b.containerName));
}

export function buildMockSearchIndex(): SearchIndexItem[] {
  return MOCK_FIXTURES.map((item) => {
    const values: SearchIndexItem["values"] = {};
    const supportedVariants = variantsForCategory(item.category);
    const now = new Date().toISOString();
    for (const variant of supportedVariants) {
      const v = item.values[variant];
      if (v == null) continue;
      values[variant] = {
        variant,
        valueRp: v,
        minRp: v,
        maxRp: v,
        sourceCount: 1,
        confidence: "low",
        isSuspicious: false,
        lastAcceptedAt: now,
        calculatedAt: now,
      };
    }
    return {
      id: toSlug(item.name),
      slug: item.slug,
      name: item.name,
      category: item.category,
      rarity: item.rarity ?? null,
      aliases: item.aliases ?? [],
      isHighTier: item.isHighTier ?? false,
      imageUrl: null,
      values,
    };
  });
}
