import "dotenv/config";
import { requireSupabaseAdmin } from "../src/server/supabase";

const db = requireSupabaseAdmin();
const slugs = process.argv.slice(2);
const { data, error } = await db
  .from("items")
  .select("slug, name, category, rarity, is_high_tier")
  .in("slug", slugs.length ? slugs : ["giraffe", "shadow-dragon", "bat-dragon", "ant", "owl", "frost-dragon"]);
if (error) throw error;
console.log(JSON.stringify(data, null, 2));
