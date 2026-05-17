#!/usr/bin/env tsx
import "dotenv/config";
import { buildAmverseAdapters } from "../src/server/sources/amverse";
import {
  buildAliasMap,
  buildCandidateDataset,
  normalizeSourceValues,
} from "../src/shared/normalize";
import { MOCK_FIXTURES } from "../src/server/sources/mockFixtures";
import { requireSupabaseAdmin } from "../src/server/supabase";

async function main() {
  const [adapter] = buildAmverseAdapters({ enabled: true });
  const raw = await adapter.fetchValues();
  console.log("Raw AMVerse rows:", raw.length);

  const aliasMap = buildAliasMap(MOCK_FIXTURES);
  const normalized = normalizeSourceValues(raw, aliasMap);
  const candidate = buildCandidateDataset(normalized);
  console.log("Candidate rows:", candidate.rows.length);
  let totalSourceContribs = 0;
  let sourceCountDist = new Map<number, number>();
  for (const row of candidate.rows) {
    totalSourceContribs += row.values.length;
    sourceCountDist.set(
      row.values.length,
      (sourceCountDist.get(row.values.length) ?? 0) + 1
    );
  }
  console.log("Total source contributions to candidate:", totalSourceContribs);
  console.log("Distribution of source counts per row:");
  for (const [k, v] of [...sourceCountDist.entries()].sort()) {
    console.log(`  ${k} sources × ${v} rows`);
  }

  // Now actually try inserting a chunk and see if Supabase returns a count
  const db = requireSupabaseAdmin();
  const { count: before } = await db
    .from("source_values")
    .select("*", { count: "exact", head: true });
  console.log(`source_values count before: ${before}`);

  // Try inserting just AMVerse's contributions
  const itemSlugs = new Set(candidate.rows.map((r) => r.itemSlug));
  const { data: items } = await db
    .from("items")
    .select("id, slug")
    .in("slug", [...itemSlugs]);
  console.log(`Looked up ${items?.length ?? 0} items for ${itemSlugs.size} slugs`);
  const slugToId = new Map((items ?? []).map((i: any) => [i.slug, i.id]));

  const payload: any[] = [];
  for (const r of candidate.rows) {
    const itemId = slugToId.get(r.itemSlug);
    if (!itemId) continue;
    for (let i = 0; i < r.values.length; i++) {
      payload.push({
        item_id: itemId,
        variant: r.variant,
        source_name: r.sources[i],
        value_rp: r.values[i],
        fetched_at: new Date().toISOString(),
      });
    }
  }
  console.log(`Payload size: ${payload.length} rows`);
  console.log(`Sample payload[0]:`, payload[0]);

  // Try one chunk
  const sample = payload.slice(0, 500);
  const { error, count } = await db
    .from("source_values")
    .insert(sample, { count: "exact" });
  if (error) {
    console.error("Insert error:", error);
  } else {
    console.log(`Inserted ${count} of ${sample.length} sample rows`);
  }

  const { count: after } = await db
    .from("source_values")
    .select("*", { count: "exact", head: true });
  console.log(`source_values count after: ${after}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
