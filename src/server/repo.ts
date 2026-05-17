import type {
  AggregatedVariantValue,
  CandidateRow,
  ImportRunStatus,
  ImportRunSummary,
  Item,
  ItemCategory,
  LiveDataset,
  LiveRow,
  SearchIndexItem,
  Variant,
} from "../shared/types";
import { aggregateValues, confidenceFor } from "../shared/aggregate";
import { variantsForCategory } from "../shared/variants";
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
  const payload = items.map((i) => ({
    slug: i.slug,
    name: i.name,
    category: i.category,
    rarity: i.rarity ?? null,
    aliases: i.aliases ?? [],
    is_high_tier: i.isHighTier ?? false,
    image_path: i.imagePath ?? null,
    updated_at: new Date().toISOString(),
  }));
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

  const payload = rows
    .map((r) => {
      const itemId = slugToId.get(r.itemSlug);
      if (!itemId) return null;
      const agg = aggregateValues(r.values);
      return {
        item_id: itemId,
        variant: r.variant,
        last_candidate_value_rp: agg.valueRp,
        last_candidate_at: now.toISOString(),
        is_suspicious: true,
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  return bulkInsert("aggregated_values", payload, {
    upsert: true,
    onConflict: "item_id,variant",
  });
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
  return {
    item: mapItem(item),
    values: (aggs ?? []).map(mapAggregated),
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
    imageUrl: itemRow.image_path
      ? `/${itemRow.image_path}`.replace(/^\/+/, "/")
      : null,
    values,
  };
}

/**
 * In-memory fallback used when Supabase env vars are not configured (e.g. the
 * first time someone runs `npm run dev:netlify`). It walks the same mock
 * fixtures the adapters use and aggregates them with a fake "1 source" so the
 * UI has something to render.
 */
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
