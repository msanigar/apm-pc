#!/usr/bin/env tsx
/**
 * Read-only verification: confirms that the sync wrote real rows.
 */
import "dotenv/config";
import { requireSupabaseAdmin } from "../src/server/supabase";

async function count(table: string): Promise<number> {
  const db = requireSupabaseAdmin();
  const { count, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function main() {
  const db = requireSupabaseAdmin();

  console.log("Row counts:");
  for (const t of [
    "items",
    "aggregated_values",
    "source_values",
    "import_runs",
    "import_validation_issues",
  ]) {
    console.log(`  ${t.padEnd(28)} ${await count(t)}`);
  }

  console.log("\nLatest import_run:");
  const { data: latestRun } = await db
    .from("import_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();
  console.log(JSON.stringify(latestRun, null, 2));

  console.log("\nSample item with values (Shadow Dragon):");
  const { data: item } = await db
    .from("items")
    .select("id, slug, name, category, is_high_tier, aliases")
    .eq("slug", "shadow-dragon")
    .single();
  console.log(JSON.stringify(item, null, 2));

  if (item) {
    const { data: aggs } = await db
      .from("aggregated_values")
      .select("variant, value_rp, source_count, confidence")
      .eq("item_id", item.id)
      .order("value_rp", { ascending: true });
    console.log(
      `  ${aggs?.length ?? 0} aggregated rows for shadow-dragon:`
    );
    for (const a of aggs ?? []) {
      console.log(
        `    ${String(a.variant).padEnd(15)} ${String(a.value_rp).padStart(8)} RP  (${a.source_count} src, ${a.confidence})`
      );
    }
  }

  console.log("\nDoes 'Ant' exist?");
  const { data: ant } = await db
    .from("items")
    .select("id, slug, name, category")
    .ilike("name", "ant")
    .limit(5);
  console.log(JSON.stringify(ant, null, 2));

  console.log("\nTop 15 items by NFR / MFR value:");
  const { data: top } = await db
    .from("aggregated_values")
    .select("variant, value_rp, items!inner(name, slug)")
    .in("variant", ["neon_fly_ride", "mega_fly_ride", "regular"])
    .order("value_rp", { ascending: false })
    .limit(15);
  for (const row of top ?? []) {
    const item = (row as any).items;
    console.log(
      `  ${item.name.padEnd(35)} ${String(row.variant).padEnd(15)} ${String(row.value_rp).padStart(8)} RP`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
