import "dotenv/config";
import { requireSupabaseAdmin } from "../src/server/supabase";

const db = requireSupabaseAdmin();
const slug = process.argv[2] ?? "bat-dragon";

const { data: rawRows, error } = await db
  .from("source_values")
  .select("source_id, raw_name, variant, value, rarity, category, image_url, is_high_tier")
  .eq("item_slug", slug)
  .limit(50);

if (error) throw error;
console.log(`source_values for slug=${slug}:`);
for (const r of rawRows ?? []) {
  console.log(JSON.stringify(r));
}
