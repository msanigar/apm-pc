/**
 * Compare per-source values across the same (item, variant) tuple so we can
 * see how badly Gizmo disagrees with AMVerse and AMTV. Helps design the
 * outlier-rejection thresholds.
 */
import "dotenv/config";
import { requireSupabaseAdmin } from "../src/server/supabase";

const db = requireSupabaseAdmin();
const slugs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "ant",
      "owl",
      "bat-dragon",
      "shadow-dragon",
      "frost-dragon",
      "giraffe",
      "queen-bee",
      "dalmatian",
      "elephant",
      "kitsune",
    ];

const { data: items, error: itemsErr } = await db
  .from("items")
  .select("id, slug, name")
  .in("slug", slugs);
if (itemsErr) throw itemsErr;

const itemIds = (items ?? []).map((i: any) => i.id);
const { data, error } = await db
  .from("source_values")
  .select("item_id, variant, source_name, value_rp")
  .in("item_id", itemIds);
if (error) throw error;

const byItem = new Map<string, any>();
for (const i of items ?? []) byItem.set(i.id, i);

const grouped = new Map<string, Map<string, Map<string, number>>>();
for (const r of data ?? []) {
  const slug = byItem.get(r.item_id)?.slug as string | undefined;
  if (!slug) continue;
  const variantMap = grouped.get(slug) ?? new Map();
  const sourceMap = variantMap.get(r.variant) ?? new Map();
  sourceMap.set(r.source_name, Number(r.value_rp));
  variantMap.set(r.variant, sourceMap);
  grouped.set(slug, variantMap);
}

for (const slug of slugs) {
  console.log(`\n=== ${slug} ===`);
  const variantMap = grouped.get(slug);
  if (!variantMap) {
    console.log("  (no data)");
    continue;
  }
  for (const [variant, sourceMap] of [...variantMap.entries()].sort()) {
    const parts: string[] = [];
    for (const [src, v] of [...sourceMap.entries()].sort()) {
      parts.push(`${src}=${v}`);
    }
    console.log(`  ${variant.padEnd(16)} ${parts.join("  ")}`);
  }
}
