#!/usr/bin/env tsx
/**
 * Refresh egg hatch data from the Adopt Me Fandom wiki, independently of
 * the value sync.
 *
 *   npm run sync:eggs
 *
 * Behaviour:
 *   - Loads `.env` automatically (when present).
 *   - Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; refuses to run
 *     without them (dry-run mode is uninteresting for hatch data).
 *   - Walks `Category:Eggs`, parses each page's `{{Eggs}}` template and
 *     `== Obtainable Pets ==` table, and upserts into `egg_hatch_odds` /
 *     `egg_hatch_pets`.
 *
 * Tunables (env):
 *   FANDOM_EGGS_MAX_PAGES   limit the number of egg pages fetched (handy
 *                           when debugging a single page)
 *   FANDOM_EGGS_DELAY_MS    sleep between page fetches (default 250)
 */
import "dotenv/config";
import { fetchFandomEggs } from "../src/server/sources/fandomEggs";
import { replaceEggHatchData } from "../src/server/repo";
import { hasSupabaseAdmin } from "../src/server/supabase";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!dryRun && !hasSupabaseAdmin()) {
    console.error(
      "Refusing to run: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.\n" +
        "Pass --dry-run to test the adapter without writing to Supabase."
    );
    process.exit(1);
  }

  const maxPages = numericEnv("FANDOM_EGGS_MAX_PAGES");
  const delayMs = numericEnv("FANDOM_EGGS_DELAY_MS") ?? 250;

  console.log(
    `Fetching egg pages from Adopt Me wiki ` +
      `(maxPages=${maxPages ?? "all"}, delayMs=${delayMs}, dryRun=${dryRun})…`
  );
  const payload = await fetchFandomEggs({ maxPages, delayMs });
  console.log(
    `Fetched: eggs=${payload.eggCount}, oddRows=${payload.odds.length}, petRows=${payload.pets.length}`
  );

  if (dryRun) {
    // Compact per-egg summary so the user can eyeball that the parser worked.
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
      console.log(`  ${egg.padEnd(28)}  odds=${odds} pets=${pets}`);
    }
    console.log("Dry run complete; not writing to Supabase.");
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

  console.log("Refresh complete:");
  console.log(JSON.stringify(result, null, 2));
}

function numericEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

main().catch((err) => {
  console.error("Egg sync failed:", err);
  process.exit(1);
});
