#!/usr/bin/env tsx
/**
 * Per-source breakdown: confirms every enabled adapter actually wrote rows.
 */
import "dotenv/config";
import { requireSupabaseAdmin } from "../src/server/supabase";

async function main() {
  const db = requireSupabaseAdmin();

  const { data, error } = await db
    .from("source_values")
    .select("source_name, variant");
  if (error) throw error;

  const bySource = new Map<string, Map<string, number>>();
  for (const row of data ?? []) {
    const src = bySource.get(row.source_name) ?? new Map<string, number>();
    src.set(row.variant, (src.get(row.variant) ?? 0) + 1);
    bySource.set(row.source_name, src);
  }

  console.log("Source / variant breakdown:");
  for (const [src, variants] of [...bySource.entries()].sort()) {
    const total = [...variants.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${src.padEnd(28)} ${String(total).padStart(6)} rows`);
    for (const [v, count] of [...variants.entries()].sort()) {
      console.log(`    └─ ${v.padEnd(18)} ${String(count).padStart(6)}`);
    }
  }

  console.log("\nThree-source items (sample):");
  const { data: triple } = await db
    .from("aggregated_values")
    .select("variant, value_rp, source_count, items!inner(name)")
    .gte("source_count", 3)
    .order("value_rp", { ascending: false })
    .limit(10);
  for (const row of triple ?? []) {
    const name = (row as any).items.name;
    console.log(
      `  ${name.padEnd(30)} ${String(row.variant).padEnd(15)} ${String(row.value_rp).padStart(7)} RP  (${row.source_count} sources)`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
