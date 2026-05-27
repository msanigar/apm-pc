#!/usr/bin/env tsx
/**
 * Restore `items.image_path` from the `item_images` audit log.
 *
 * Use when image_path was accidentally cleared (e.g. sync upsert sent null)
 * but files still exist in Supabase Storage.
 *
 *   npm run restore:images -- --dry-run
 *   npm run restore:images
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { hasSupabaseAdmin } from "../src/server/supabase";

const PAGE = 1000;
const UPDATE_CHUNK = 200;

async function loadLatestPathsByItemId(): Promise<Map<string, string>> {
  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const latest = new Map<string, string>();

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("item_images")
      .select("item_id, storage_path, fetched_at")
      .order("fetched_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const id = row.item_id as string;
      if (!id || latest.has(id)) continue;
      latest.set(id, row.storage_path as string);
    }
    if (data.length < PAGE) break;
  }

  return latest;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!hasSupabaseAdmin()) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }

  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log("Loading latest storage_path per item from item_images…");
  const latestByItemId = await loadLatestPathsByItemId();
  console.log(`  audit map: ${latestByItemId.size} items`);

  const { count: missingBefore } = await db
    .from("items")
    .select("*", { count: "exact", head: true })
    .is("image_path", null);

  const updates: Array<{ id: string; slug: string; image_path: string }> = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("items")
      .select("id, slug, image_path")
      .is("image_path", null)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const path = latestByItemId.get(row.id as string);
      if (path) {
        updates.push({
          id: row.id as string,
          slug: row.slug as string,
          image_path: path,
        });
      }
    }
    if (data.length < PAGE) break;
  }

  console.log(
    `  items missing image_path: ${missingBefore ?? "?"}, can restore: ${updates.length}`
  );

  if (dryRun) {
    console.log("\nDry-run preview (first 15):");
    for (const u of updates.slice(0, 15)) {
      console.log(`  ${u.slug} → ${u.image_path}`);
    }
    return;
  }

  let restored = 0;
  for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
    const chunk = updates.slice(i, i + UPDATE_CHUNK);
    await Promise.all(
      chunk.map((u) =>
        db
          .from("items")
          .update({
            image_path: u.image_path,
            updated_at: new Date().toISOString(),
          })
          .eq("id", u.id)
      )
    );
    restored += chunk.length;
    if (restored % 500 === 0 || restored === updates.length) {
      console.log(`  restored ${restored}/${updates.length}`);
    }
  }

  const { count: missingAfter } = await db
    .from("items")
    .select("*", { count: "exact", head: true })
    .is("image_path", null);

  console.log(`Done. Restored ${restored} rows. Still missing: ${missingAfter ?? "?"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
