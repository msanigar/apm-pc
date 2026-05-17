#!/usr/bin/env tsx
/**
 * Read the current Supabase state and emit a TypeScript catalog file that
 * lives alongside the mock adapters as a hand-curated fallback.
 *
 * Why:
 *   The live sync pipeline (real adapters) keeps the catalog fresh, but if
 *   it ever fails for several days in a row we don't want the app to fall
 *   back to a 10-pet mock dataset. Instead we commit a "best guess today"
 *   snapshot derived from the highest-confidence rows currently in
 *   `aggregated_values` and let `buildItemUpserts` pick from this file
 *   whenever the live sync is unavailable.
 *
 * Output:
 *   Overwrites `src/server/sources/mockFixtures.ts` with the snapshot.
 *
 * Behaviour:
 *   - Only includes items where the median value across variants is > 0.
 *   - Caps at MAX_ITEMS items (default 350), ordered by max_rp DESC across
 *     all variants — i.e. "the most tradeable pets first".
 *   - Pulls all variants the DB has for each kept item.
 *   - Preserves hand-tuned aliases for legendaries (so the mock adapters
 *     keep their fuzzy-match coverage).
 *
 * Usage:
 *   npm run dump:catalog
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { requireSupabaseAdmin } from "../src/server/supabase";
import type { ItemCategory, Variant } from "../src/shared/types";

const MAX_ITEMS = 350;
const MIN_TOP_VALUE = 0.5; // skip items whose best variant is < 0.5 RP

/**
 * Hand-curated aliases for the highest-tier items. The live adapters don't
 * publish these, so we preserve them on the way out. Keys are slugs.
 */
const CURATED_ALIASES: Record<string, string[]> = {
  "shadow-dragon": ["shadow", "shadow drag", "shad drag", "sd"],
  "bat-dragon": ["bat", "bat drag", "bd"],
  "frost-dragon": ["frost", "frost drag", "fd"],
  giraffe: ["giraffe", "raffe"],
  owl: ["owl", "owly"],
  parrot: ["parrot", "pirate parrot"],
  crow: ["crow"],
  "evil-unicorn": ["eu", "evil uni", "evil unicorn"],
  "arctic-reindeer": ["ar", "reindeer", "arctic"],
  "albino-monkey": ["am", "albino"],
  "queen-bee": ["queen", "queen b", "qb"],
  dalmatian: ["dalmatian", "dally"],
  "frost-fury": ["frost fury", "ff"],
  "monkey-king": ["monkey king", "mk"],
  cerberus: ["cerb", "cerberus"],
  kitsune: ["kit", "kitsune"],
  "diamond-griffin": ["dgrif", "diamond grif"],
  griffin: ["grif", "griffin"],
  "robo-dog": ["robo dog", "robo"],
  "scorpio-zodiac-minion": ["scorpio", "scorpio minion"],
};

function quote(s: string): string {
  // Always emit double-quoted strings, escaping any internal quotes.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function fmtNumber(n: number): string {
  // Trim trailing .0 / scientific notation when not needed.
  if (Number.isInteger(n)) return String(n);
  return n
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

async function main() {
  const db = requireSupabaseAdmin();

  console.log(`Reading top ${MAX_ITEMS} items from Supabase…`);

  // Find candidate item ids: items with the highest max value across any
  // variant. PostgREST caps a single SELECT at 1000 rows so we page in
  // chunks of 1000 until we've collected MAX_ITEMS unique item_ids (or run
  // out of rows above MIN_TOP_VALUE).
  const seen = new Set<string>();
  const itemIds: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; itemIds.length < MAX_ITEMS; offset += PAGE) {
    const { data: page, error: pageErr } = await db
      .from("aggregated_values")
      .select("item_id, value_rp")
      .order("value_rp", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (pageErr) throw pageErr;
    if (!page || page.length === 0) break;
    for (const r of page) {
      if (Number(r.value_rp) < MIN_TOP_VALUE) continue;
      if (seen.has(r.item_id)) continue;
      seen.add(r.item_id);
      itemIds.push(r.item_id);
      if (itemIds.length >= MAX_ITEMS) break;
    }
    if (page.length < PAGE) break;
  }
  console.log(`  ${itemIds.length} unique high-value items selected`);

  const { data: items, error: itemsErr } = await db
    .from("items")
    .select("id, slug, name, category, rarity, is_high_tier, aliases")
    .in("id", itemIds);
  if (itemsErr) throw itemsErr;
  const itemMap = new Map((items ?? []).map((i: any) => [i.id, i]));

  // Pull variant values in small chunks. Each item has up to 12 variants
  // and PostgREST caps a single SELECT at 1000 rows, so we keep chunks at
  // 60 items (60 × 12 = 720 rows max per request) to stay well clear.
  const variants = new Map<string, Map<string, number>>();
  const CHUNK = 60;
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const chunk = itemIds.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("aggregated_values")
      .select("item_id, variant, value_rp")
      .in("item_id", chunk)
      .range(0, 9999);
    if (error) throw error;
    for (const v of data ?? []) {
      const id = v.item_id as string;
      const map = variants.get(id) ?? new Map<string, number>();
      map.set(v.variant as string, Number(v.value_rp));
      variants.set(id, map);
    }
  }
  console.log(`  Loaded variants for ${variants.size} items`);

  // Sort kept items by max value DESC, then alphabetically as tiebreaker.
  const ordered = itemIds
    .filter((id) => itemMap.has(id) && variants.has(id))
    .map((id) => {
      const item = itemMap.get(id)!;
      const vars = variants.get(id)!;
      const maxVal = Math.max(...vars.values());
      return { id, item, vars, maxVal };
    })
    .sort((a, b) => {
      if (b.maxVal !== a.maxVal) return b.maxVal - a.maxVal;
      return (a.item.name as string).localeCompare(b.item.name as string);
    });

  // Emit the TypeScript module.
  const lines: string[] = [];
  lines.push(
    "/**",
    " * Hand-curated baseline catalog.",
    " *",
    " * Auto-generated by `npm run dump:catalog` from the live Supabase data",
    " * captured on " + new Date().toISOString().slice(0, 10) + ". Edit this file",
    " * by hand only to tweak aliases or fix typos — re-run the dump script to",
    " * refresh values from a recent sync.",
    " *",
    " * Used in two places:",
    " *   1. `MOCK_FIXTURES` powers the three mock adapters used in offline",
    " *      tests and the `mock-only` adapter mode.",
    " *   2. `buildItemUpserts` in syncValues falls back to this catalog for",
    " *      item metadata (name, aliases, isHighTier) when a real adapter",
    " *      reports a slug we don't recognise.",
    " *",
    " * So if every real adapter is offline for a week, the app still shows",
    " * the " + ordered.length + " items below with their last-known values.",
    " */",
    "",
    'import type { ItemCategory, Variant } from "../../shared/types";',
    "",
    "export type MockItem = {",
    "  slug: string;",
    "  name: string;",
    "  category: ItemCategory;",
    "  rarity?: string;",
    "  isHighTier?: boolean;",
    "  imageUrl?: string;",
    "  aliases?: string[];",
    "  /** Map of variant → canonical RP value. */",
    "  values: Partial<Record<Variant, number>>;",
    "};",
    "",
    "export const MOCK_FIXTURES: MockItem[] = ["
  );

  for (const { item, vars } of ordered) {
    const slug = item.slug as string;
    const aliases = (CURATED_ALIASES[slug] ??
      (Array.isArray(item.aliases) ? (item.aliases as string[]) : [])) as string[];
    lines.push("  {");
    lines.push(`    slug: ${quote(slug)},`);
    lines.push(`    name: ${quote(item.name as string)},`);
    lines.push(`    category: ${quote(item.category as ItemCategory)} as const,`);
    if (item.rarity) lines.push(`    rarity: ${quote(item.rarity as string)},`);
    if (item.is_high_tier) lines.push(`    isHighTier: true,`);
    if (aliases.length > 0) {
      lines.push(`    aliases: [${aliases.map(quote).join(", ")}],`);
    }
    lines.push(`    values: {`);
    const sortedVariants = [...vars.entries()].sort();
    for (const [v, val] of sortedVariants) {
      lines.push(`      ${v as Variant}: ${fmtNumber(val)},`);
    }
    lines.push(`    },`);
    lines.push(`  },`);
  }

  lines.push("];");
  lines.push("");

  const outPath = path.join(
    process.cwd(),
    "src/server/sources/mockFixtures.ts"
  );
  writeFileSync(outPath, lines.join("\n"));
  console.log(
    `Wrote ${ordered.length} items (${
      Math.round(lines.join("\n").length / 1024)
    } KB) to ${path.relative(process.cwd(), outPath)}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
