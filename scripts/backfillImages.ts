#!/usr/bin/env tsx
/**
 * One-time image backfill.
 *
 *   npm run backfill:images           # fill anything missing
 *   npm run backfill:images -- --dry-run
 *   npm run backfill:images -- --refresh   # force re-download every image
 *
 * Behaviour:
 *   1. Runs every enabled value adapter once and harvests its `imageUrl`
 *      hints. This is the same data the nightly sync uses; we just run it
 *      independently so the catalog can be seeded without waiting for the
 *      cron job.
 *   2. Walks `Category:Eggs` on the Adopt Me Fandom wiki, extracts each
 *      page's `{{Eggs|image=...}}` filename, and resolves it to a CDN URL.
 *      This covers eggs, which the value adapters don't carry images for.
 *   3. For every item in `items` that doesn't already have an `image_path`
 *      (unless `--refresh`), fetches the source URL, uploads it to the
 *      configured Supabase Storage bucket, and writes the path back.
 *
 * Prerequisites (in Supabase):
 *   - A public bucket named `${SUPABASE_IMAGE_BUCKET}` (defaults to
 *     "adopt-me"). The bucket must be PUBLIC so the frontend can read
 *     images without a signed URL.
 *   - SERVICE_ROLE_KEY env var available locally (it's only used here, never
 *     shipped to the browser).
 *
 * Tunables (env):
 *   BACKFILL_IMAGES_DELAY_MS   sleep between Storage uploads (default 25)
 *   FANDOM_EGGS_DELAY_MS       sleep between wiki page fetches (default 250)
 *   FANDOM_EGGS_MAX_PAGES      cap number of egg pages parsed (testing only)
 */
import "dotenv/config";
import {
  cacheImagesForSlugs,
  type ImageJob,
} from "../src/server/images";
import {
  fetchFandomEggImages,
  FANDOM_SOURCE,
} from "../src/server/sources/fandomWiki";
import { getEnabledAdapters } from "../src/server/sources/index";
import { buildAliasMap, normalizeSourceValues } from "../src/shared/normalize";
import { MOCK_FIXTURES } from "../src/server/sources/mockFixtures";
import {
  getSupabaseAdmin,
  hasSupabaseAdmin,
} from "../src/server/supabase";
import type { RawSourceValue } from "../src/shared/normalize";

type ItemRow = {
  id: string;
  slug: string;
  category: string;
  image_path: string | null;
};

async function loadAllItems(): Promise<ItemRow[]> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase admin client not configured");
  const rows: ItemRow[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("items")
      .select("id, slug, category, image_path")
      .order("slug", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as ItemRow[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function harvestValueAdapterImages(): Promise<Map<string, string>> {
  const adapters = getEnabledAdapters();
  if (adapters.length === 0) return new Map();

  const raw: RawSourceValue[] = [];
  for (const adapter of adapters) {
    try {
      const values = await adapter.fetchValues();
      raw.push(...values);
    } catch (err) {
      console.warn(`[backfill] adapter ${adapter.name} failed:`, err);
    }
  }

  const aliasMap = buildAliasMap(MOCK_FIXTURES);
  const normalized = normalizeSourceValues(raw, aliasMap);
  const nameToSlug = new Map<string, string>();
  for (const n of normalized) nameToSlug.set(n.sourceItemName, n.itemSlug);

  // Last writer wins, but we explicitly prefer pet images — when an item is
  // referenced multiple times (e.g. AMVerse + AMTV), either URL is fine.
  const out = new Map<string, string>();
  for (const r of raw) {
    if (!r.imageUrl) continue;
    const slug = nameToSlug.get(r.sourceItemName);
    if (!slug) continue;
    if (!out.has(slug)) out.set(slug, r.imageUrl);
  }
  return out;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const refresh = process.argv.includes("--refresh");

  if (!hasSupabaseAdmin()) {
    console.error(
      "Refusing to run: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set."
    );
    process.exit(1);
  }

  console.log(
    `Image backfill starting (dryRun=${dryRun}, refresh=${refresh})…`
  );

  // 1) Load the catalog.
  const items = await loadAllItems();
  const missing = refresh ? items : items.filter((i) => !i.image_path);
  console.log(
    `  catalog: total=${items.length} missing_image=${
      items.filter((i) => !i.image_path).length
    } will_process=${missing.length}`
  );
  if (missing.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const missingSlugs = new Set(missing.map((i) => i.slug));
  const missingEggSlugs = new Set(
    missing.filter((i) => i.category === "egg").map((i) => i.slug)
  );

  // 2) Harvest value-adapter image URLs (covers pets + a lot of items).
  console.log("Harvesting source image URLs from value adapters…");
  const valueAdapterUrls = await harvestValueAdapterImages();
  console.log(`  value adapters: ${valueAdapterUrls.size} URLs`);

  // 3) Resolve egg images from the wiki (the value adapters don't carry
  //    eggs). Only fetch pages for eggs we actually need.
  let eggUrls = new Map<string, string>();
  if (missingEggSlugs.size > 0) {
    console.log(
      `Resolving egg images from Fandom (${missingEggSlugs.size} eggs)…`
    );
    const maxPages = numericEnv("FANDOM_EGGS_MAX_PAGES");
    const delayMs = numericEnv("FANDOM_EGGS_DELAY_MS") ?? 250;
    const discovery = await fetchFandomEggImages({
      maxPages,
      delayMs,
      onlyEggSlugs: missingEggSlugs,
    });
    eggUrls = discovery.bySlug;
    console.log(`  fandom: ${eggUrls.size} egg image URLs resolved`);
  }

  // 4) Merge into a single job list. Eggs from Fandom take precedence over
  //    anything a value adapter might have hallucinated (it won't, but
  //    explicit beats implicit).
  const jobs: ImageJob[] = [];
  for (const item of missing) {
    if (!missingSlugs.has(item.slug)) continue;
    if (eggUrls.has(item.slug)) {
      jobs.push({
        itemSlug: item.slug,
        sourceUrl: eggUrls.get(item.slug)!,
        sourceName: FANDOM_SOURCE,
      });
      continue;
    }
    const url = valueAdapterUrls.get(item.slug);
    if (url) {
      jobs.push({
        itemSlug: item.slug,
        sourceUrl: url,
        sourceName: "value_adapter",
      });
    }
  }
  console.log(
    `  jobs: ${jobs.length} of ${missing.length} have a source URL ` +
      `(${missing.length - jobs.length} unmatched)`
  );

  if (dryRun) {
    console.log("\nDry-run preview (first 20 jobs):");
    for (const job of jobs.slice(0, 20)) {
      console.log(`  ${job.itemSlug.padEnd(32)}  ←  ${job.sourceUrl}`);
    }
    if (jobs.length > 20) console.log(`  …and ${jobs.length - 20} more`);
    return;
  }

  // 5) Run the cache step.
  const delayMs = numericEnv("BACKFILL_IMAGES_DELAY_MS") ?? 25;
  let lastLog = 0;
  const result = await cacheImagesForSlugs(jobs, {
    skipIfPresent: !refresh,
    delayMs,
    onProgress: ({ done, total, slug, status }) => {
      // Throttle progress lines so the terminal doesn't choke.
      const now = Date.now();
      if (now - lastLog < 250 && done < total) return;
      lastLog = now;
      process.stdout.write(
        `  [${String(done).padStart(4)}/${total}] ${status.padEnd(8)} ${slug}\n`
      );
    },
  });

  console.log("\nBackfill complete:");
  console.log(JSON.stringify(result, null, 2));

  // Print the unmatched slugs so the operator knows which items still need
  // a manual image upload.
  const unmatched = missing
    .filter((i) => !jobs.some((j) => j.itemSlug === i.slug))
    .map((i) => i.slug);
  if (unmatched.length > 0) {
    console.log(
      `\n${unmatched.length} item(s) had no source image URL ` +
        `(first 30):`
    );
    for (const slug of unmatched.slice(0, 30)) console.log(`  - ${slug}`);
  }
}

function numericEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

main().catch((err) => {
  console.error("Image backfill failed:", err);
  process.exit(1);
});
