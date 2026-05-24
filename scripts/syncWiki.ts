#!/usr/bin/env tsx
/**
 * Refresh wiki-sourced data from the Adopt Me Fandom wiki, independently of
 * the value sync.
 *
 *   npm run sync:wiki                      — run every pass
 *   npm run sync:wiki -- --skip-pets       — eggs + gift contents only
 *   npm run sync:wiki -- --skip-gifts      — eggs + pet acquisitions
 *   npm run sync:wiki -- --skip-eggs       — gifts + pet acquisitions
 *   npm run sync:wiki -- --dry-run         — parse without writing
 *
 * Behaviour:
 *   - Loads `.env` automatically (when present).
 *   - Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; refuses to run
 *     without them (dry-run mode bypasses this check).
 *   - Three independent passes, each safe to retry:
 *       eggs   — Category:Eggs → egg_hatch_odds + egg_hatch_pets
 *       gifts  — Category:Gifts → item_contents (+ egg_hatch_odds for
 *                random-content boxes that publish per-rarity odds)
 *       pets   — every pet in our catalog → pet_acquisitions
 *
 * Tunables (env):
 *   SYNC_WIKI_MAX_PAGES        cap on pages per pass (handy when debugging)
 *   SYNC_WIKI_DELAY_MS         sleep between page fetches (default 250)
 *
 *   Legacy aliases — kept for backwards compatibility with the old
 *   `npm run sync:eggs` workflow:
 *   FANDOM_EGGS_MAX_PAGES, FANDOM_EGGS_DELAY_MS
 */
import "dotenv/config";
import {
  fetchFandomEggs,
  fetchFandomGifts,
  fetchPetAcquisitions,
} from "../src/server/sources/fandomWiki";
import {
  replaceEggHatchData,
  replaceItemContentsData,
  replacePetAcquisitionsData,
} from "../src/server/repo";
import { hasSupabaseAdmin, requireSupabaseAdmin } from "../src/server/supabase";

type Flags = {
  dryRun: boolean;
  skipEggs: boolean;
  skipGifts: boolean;
  skipPets: boolean;
};

function parseFlags(): Flags {
  const argv = new Set(process.argv.slice(2));
  return {
    dryRun: argv.has("--dry-run"),
    skipEggs: argv.has("--skip-eggs"),
    skipGifts: argv.has("--skip-gifts"),
    skipPets: argv.has("--skip-pets"),
  };
}

async function main() {
  const flags = parseFlags();
  if (!flags.dryRun && !hasSupabaseAdmin()) {
    console.error(
      "Refusing to run: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.\n" +
        "Pass --dry-run to test the adapters without writing to Supabase."
    );
    process.exit(1);
  }

  const maxPages =
    numericEnv("SYNC_WIKI_MAX_PAGES") ?? numericEnv("FANDOM_EGGS_MAX_PAGES");
  const delayMs =
    numericEnv("SYNC_WIKI_DELAY_MS") ??
    numericEnv("FANDOM_EGGS_DELAY_MS") ??
    250;

  console.log(
    `[sync:wiki] starting (maxPages=${maxPages ?? "all"}, delayMs=${delayMs}, dryRun=${flags.dryRun})`
  );

  if (!flags.skipEggs) await runEggs(flags, maxPages, delayMs);
  if (!flags.skipGifts) await runGifts(flags, maxPages, delayMs);
  if (!flags.skipPets) await runPetAcquisitions(flags, maxPages, delayMs);

  console.log("[sync:wiki] all passes complete.");
}

async function runEggs(flags: Flags, maxPages: number | undefined, delayMs: number) {
  console.log("\n[sync:wiki] === eggs ===");
  const payload = await fetchFandomEggs({ maxPages, delayMs });
  console.log(
    `  fetched: eggs=${payload.eggCount}, oddRows=${payload.odds.length}, petRows=${payload.pets.length}`
  );

  if (flags.dryRun) {
    summariseEggs(payload);
    return;
  }

  const result = await replaceEggHatchData({
    odds: payload.odds.map((o) => ({
      eggSlug: o.eggSlug,
      rarity: o.rarity,
      probabilityPct: o.probabilityPct,
      source: o.source,
      sourceRevisionId: o.sourceRevisionId,
      fetchedAt: payload.fetchedAt,
    })),
    pets: payload.pets.map((p) => ({
      eggSlug: p.eggSlug,
      petSlug: p.petSlug,
      petDisplayName: p.petDisplayName,
      rarity: p.rarity,
      source: p.source,
      sourceRevisionId: p.sourceRevisionId,
      fetchedAt: payload.fetchedAt,
    })),
  });
  console.log(`  result: ${JSON.stringify(result)}`);
}

async function runGifts(flags: Flags, maxPages: number | undefined, delayMs: number) {
  console.log("\n[sync:wiki] === gifts ===");
  const payload = await fetchFandomGifts({ maxPages, delayMs });
  console.log(
    `  fetched: gifts=${payload.giftCount}, items=${payload.items.length}, odds=${payload.oddsByGift.length}`
  );

  if (flags.dryRun) {
    summariseGifts(payload);
    return;
  }

  const result = await replaceItemContentsData({
    items: payload.items.map((i) => ({
      containerSlug: i.giftSlug,
      containedSlug: i.itemSlug,
      containedDisplayName: i.itemDisplayName,
      rarity: i.rarity,
      categoryHint: i.categoryHint,
      dropChancePct: i.chancePct,
      source: i.source,
      sourceRevisionId: i.sourceRevisionId,
      fetchedAt: payload.fetchedAt,
    })),
    odds: payload.oddsByGift.map((o) => ({
      eggSlug: o.eggSlug,
      rarity: o.rarity,
      probabilityPct: o.probabilityPct,
      source: o.source,
      sourceRevisionId: o.sourceRevisionId,
      fetchedAt: payload.fetchedAt,
    })),
  });
  console.log(`  result: ${JSON.stringify(result)}`);
}

/**
 * Build the list of pet wiki titles to walk for acquisition extraction.
 *
 * Strategy: pull every pet from our catalog, convert its name to a wiki
 * title (replace spaces with `_`). The wiki is reasonably consistent about
 * page titles matching pet names, so this is high-precision; any redirects
 * are resolved automatically by the parse API.
 */
async function buildPetTitles(): Promise<string[]> {
  if (!hasSupabaseAdmin()) {
    // Dry-run with no Supabase — fall back to a handful of known event
    // pets so the adapter still produces visible output.
    return ["Cerberus", "Bat_Dragon", "Frost_Dragon", "Robin", "Sasquatch"];
  }
  const db = requireSupabaseAdmin();
  const titles: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from("items")
      .select("name, category")
      .eq("category", "pet")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const name = (row as { name?: string }).name;
      if (!name) continue;
      // Wiki titles are space-or-underscore tolerant; we use underscores
      // because some fixtures and curl examples in the repo do too.
      titles.push(name.trim().replace(/\s+/g, "_"));
    }
    if (data.length < PAGE) break;
  }
  return titles;
}

async function runPetAcquisitions(
  flags: Flags,
  maxPages: number | undefined,
  delayMs: number
) {
  console.log("\n[sync:wiki] === pet acquisitions ===");
  const titles = await buildPetTitles();
  console.log(`  catalog pets: ${titles.length}`);

  const payload = await fetchPetAcquisitions({
    titles,
    delayMs,
    maxPages,
  });
  console.log(
    `  fetched: ${payload.pageCount}, acquisitions=${payload.acquisitions.length}, skipped=${payload.skipped.length}`
  );

  if (flags.dryRun) {
    summariseAcquisitions(payload);
    return;
  }

  const result = await replacePetAcquisitionsData({
    rows: payload.acquisitions.map((a) => ({
      petSlug: a.petSlug,
      kind: a.kind,
      eventName: a.eventName,
      eventYear: a.eventYear,
      currency: a.currency,
      cost: a.cost,
      retired: a.retired,
      releasedAt: a.releasedAt,
      notes: a.notes,
      source: a.source,
      sourceRevisionId: a.sourceRevisionId,
      fetchedAt: payload.fetchedAt,
    })),
  });
  console.log(`  result: ${JSON.stringify(result)}`);
}

/* ───────────────────── dry-run summary helpers ───────────────────── */

function summariseEggs(payload: Awaited<ReturnType<typeof fetchFandomEggs>>) {
  const byEgg = new Map<string, { odds: number; pets: number }>();
  for (const o of payload.odds) {
    const e = byEgg.get(o.eggTitle) ?? { odds: 0, pets: 0 };
    e.odds += 1;
    byEgg.set(o.eggTitle, e);
  }
  for (const p of payload.pets) {
    const e = byEgg.get(p.eggTitle) ?? { odds: 0, pets: 0 };
    e.pets += 1;
    byEgg.set(p.eggTitle, e);
  }
  for (const [egg, { odds, pets }] of byEgg) {
    console.log(`    ${egg.padEnd(28)}  odds=${odds} pets=${pets}`);
  }
}

function summariseGifts(payload: Awaited<ReturnType<typeof fetchFandomGifts>>) {
  const byGift = new Map<string, { items: number; odds: number }>();
  for (const o of payload.oddsByGift) {
    const g = byGift.get(o.eggTitle) ?? { items: 0, odds: 0 };
    g.odds += 1;
    byGift.set(o.eggTitle, g);
  }
  for (const it of payload.items) {
    const g = byGift.get(it.giftTitle) ?? { items: 0, odds: 0 };
    g.items += 1;
    byGift.set(it.giftTitle, g);
  }
  for (const [gift, { items, odds }] of byGift) {
    console.log(`    ${gift.padEnd(32)}  items=${items} odds=${odds}`);
  }
}

function summariseAcquisitions(
  payload: Awaited<ReturnType<typeof fetchPetAcquisitions>>
) {
  const byKind = new Map<string, number>();
  for (const a of payload.acquisitions) {
    byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  }
  console.log("    by kind:");
  for (const [kind, n] of byKind) {
    console.log(`      ${kind.padEnd(8)} ${n}`);
  }
  console.log(`    skipped (no signal): ${payload.skipped.length}`);
  if (payload.acquisitions.length > 0) {
    console.log("    sample:");
    for (const a of payload.acquisitions.slice(0, 5)) {
      console.log(
        `      ${a.petTitle.padEnd(24)} kind=${a.kind} event=${a.eventName ?? "-"} currency=${a.currency ?? "-"} cost=${a.cost ?? "-"} retired=${a.retired}`
      );
    }
  }
}

function numericEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

main().catch((err) => {
  console.error("Wiki sync failed:", err);
  process.exit(1);
});
