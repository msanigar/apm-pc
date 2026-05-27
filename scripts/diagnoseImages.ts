#!/usr/bin/env tsx
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { publicImageUrl } from "../src/server/images";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_IMAGE_BUCKET ?? "adopt-me";
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }

  const db = createClient(url, key);

  const { count: total } = await db
    .from("items")
    .select("*", { count: "exact", head: true });
  const { count: withPath } = await db
    .from("items")
    .select("*", { count: "exact", head: true })
    .not("image_path", "is", null);

  const { data: cow } = await db
    .from("items")
    .select("slug, image_path")
    .eq("slug", "cow")
    .maybeSingle();

  const { data: recentRuns } = await db
    .from("import_runs")
    .select("status, started_at, promoted_count, notes")
    .order("started_at", { ascending: false })
    .limit(5);

  console.log("=== image_path coverage ===");
  console.log(`total items: ${total ?? "?"}`);
  console.log(`with image_path: ${withPath ?? "?"}`);
  console.log(`missing image_path: ${(total ?? 0) - (withPath ?? 0)}`);

  console.log("\n=== sample: cow ===");
  console.log(cow);
  if (cow?.image_path) {
    const imgUrl = publicImageUrl(cow.image_path);
    console.log("public URL:", imgUrl);
    if (imgUrl) {
      const res = await fetch(imgUrl, { method: "HEAD" });
      console.log("HEAD status:", res.status);
    }
  }

  const { data: storageList } = await db.storage.from(bucket).list("items", {
    limit: 5,
  });
  console.log("\n=== storage bucket sample (items/) ===");
  console.log(
    storageList?.length
      ? storageList.map((f) => f.name)
      : `error or empty: ${JSON.stringify(storageList)}`
  );

  console.log("\n=== recent import_runs ===");
  for (const run of recentRuns ?? []) {
    const notes =
      typeof run.notes === "string" ? run.notes.slice(0, 120) : run.notes;
    console.log(`${run.started_at}  ${run.status}  promoted=${run.promoted_count}`);
    console.log(`  ${notes}…`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
