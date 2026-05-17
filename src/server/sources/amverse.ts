import * as cheerio from "cheerio";
import type { RawSourceValue } from "../../shared/normalize";
import type { ItemCategory, Variant } from "../../shared/types";
import {
  fetchText,
  normalizeSourceValue,
  resolveImageUrl,
  safeAdapter,
} from "./lib";
import type { SourceAdapter } from "./types";

/**
 * AMVerse adapter — https://amverse.co/values
 *
 * The values page on amverse.co displays a side-by-side view of pet/item
 * values from two community sources: Elvebredd and AMVGG. We treat each
 * column as its own logical source internally:
 *
 *   - source_name = "amverse_elvebredd"
 *   - source_name = "amverse_amvgg"
 *
 * That way, when median aggregation kicks in across all sources, AMVerse
 * contributes two independent data points rather than one fused one.
 *
 * IMPORTANT — Terms of Service:
 * Before enabling this adapter in production, check amverse.co's terms and
 * robots.txt. We currently only ever call this from the daily scheduled
 * sync (never from frontend requests). Image caching is not yet wired up
 * for this source — see TODO at the bottom of the file.
 *
 * IMPORTANT — Fixture parity:
 * The selectors below target the structure described in
 * `__fixtures__/amverse.values.html`. The real page may differ. When you
 * verify against the live page, update the fixture AND the selectors
 * together so the tests keep doing real work.
 */

export const AMVERSE_URL = "https://amverse.co/values";
const AMVERSE_BASE = "https://amverse.co";

const ELVEBREDD = "amverse_elvebredd";
const AMVGG = "amverse_amvgg";

const VARIANT_HEADER_MAP: Record<string, Variant | undefined> = {
  regular: "regular",
  normal: "regular",
  ride: "ride",
  fly: "fly",
  "fly ride": "fly_ride",
  fr: "fly_ride",
  neon: "neon",
  "neon ride": "neon_ride",
  "neon fly": "neon_fly",
  "neon fly ride": "neon_fly_ride",
  nfr: "neon_fly_ride",
  mega: "mega",
  "mega ride": "mega_ride",
  "mega fly": "mega_fly",
  "mega fly ride": "mega_fly_ride",
  mfr: "mega_fly_ride",
};

const SOURCE_ROW_CLASS_MAP: Record<string, string> = {
  "src-elvebredd": ELVEBREDD,
  "src-amvgg": AMVGG,
};

const CATEGORY_MAP: Record<string, ItemCategory> = {
  pet: "pet",
  pets: "pet",
  egg: "egg",
  eggs: "egg",
  vehicle: "vehicle",
  vehicles: "vehicle",
  toy: "toy",
  toys: "toy",
  stroller: "stroller",
  strollers: "stroller",
  "pet wear": "pet_wear",
  "pet-wear": "pet_wear",
  petwear: "pet_wear",
  food: "food",
  gift: "gift",
  gifts: "gift",
  potion: "potion",
  potions: "potion",
};

export function parseAmverseHtml(html: string): RawSourceValue[] {
  const $ = cheerio.load(html);
  const out: RawSourceValue[] = [];

  $(".item-card").each((_, el) => {
    const $card = $(el);
    const itemName =
      $card.attr("data-name")?.trim() ||
      $card.find("h2,h3").first().text().trim();
    if (!itemName) return;

    const category = mapCategory($card.attr("data-category"));
    const rarity = $card.attr("data-rarity")?.trim() ?? null;
    const imageUrl = resolveImageUrl(
      $card.find("img").attr("src"),
      AMVERSE_BASE
    );

    const $table = $card.find("table.values-table");
    if ($table.length === 0) return;

    // Map header column index → Variant.
    const headerVariants: Array<Variant | null> = [];
    $table
      .find("thead th")
      .each((idx, th) => {
        if (idx === 0) {
          headerVariants.push(null); // "Source" column
          return;
        }
        const label = $(th).text().trim().toLowerCase();
        headerVariants.push(VARIANT_HEADER_MAP[label] ?? null);
      });

    $table.find("tbody tr").each((_, tr) => {
      const $tr = $(tr);
      const sourceName = resolveSourceNameFromRow($tr);
      if (!sourceName) return;
      $tr.find("td").each((cellIdx, td) => {
        if (cellIdx === 0) return; // source label column
        const variant = headerVariants[cellIdx];
        if (!variant) return;
        const raw = normalizeSourceValue({
          sourceName,
          sourceItemName: itemName,
          rawValue: $(td).text(),
          category,
          variant,
          rarity,
          imageUrl,
        });
        if (raw) out.push(raw);
      });
    });
  });

  return out;
}

function resolveSourceNameFromRow($tr: cheerio.Cheerio<any>): string | null {
  for (const [cls, name] of Object.entries(SOURCE_ROW_CLASS_MAP)) {
    if ($tr.hasClass(cls)) return name;
  }
  // Fallback: derive from the first cell text.
  const label = $tr.find("td").first().text().trim().toLowerCase();
  if (label.includes("elvebredd")) return ELVEBREDD;
  if (label.includes("amvgg")) return AMVGG;
  return null;
}

function mapCategory(input: string | undefined): ItemCategory {
  if (!input) return "pet";
  return CATEGORY_MAP[input.trim().toLowerCase()] ?? "other";
}

/**
 * Build the adapter. We deliberately return TWO entries — one per
 * underlying source — so each gets its own row in `source_values` and its
 * own vote in the median aggregator.
 *
 * Both share the same `fetchValues` work: the helper hits the URL once and
 * each adapter filters down to its rows.
 */
export function buildAmverseAdapters(options: { enabled?: boolean } = {}): SourceAdapter[] {
  let cachedFetch: Promise<RawSourceValue[]> | null = null;
  const fetchOnce = () => {
    if (!cachedFetch) {
      cachedFetch = fetchText(AMVERSE_URL).then(parseAmverseHtml);
    }
    return cachedFetch;
  };

  const elvebredd = safeAdapter({
    name: ELVEBREDD,
    description: "AMVerse — Elvebredd column (scraped from amverse.co/values)",
    enabled: options.enabled,
    fetchValues: async () => {
      const all = await fetchOnce();
      return all.filter((v) => v.sourceName === ELVEBREDD);
    },
  });

  const amvgg = safeAdapter({
    name: AMVGG,
    description: "AMVerse — AMVGG column (scraped from amverse.co/values)",
    enabled: options.enabled,
    fetchValues: async () => {
      const all = await fetchOnce();
      return all.filter((v) => v.sourceName === AMVGG);
    },
  });

  return [elvebredd, amvgg];
}

// ─── TODOs ────────────────────────────────────────────────────────────────
// TODO(amverse-images): If the values table doesn't carry item images, walk
//   to each item's detail page (amverse.co/values/<slug>) once per item to
//   extract a thumbnail. Be careful: this multiplies our request count by N
//   on every sync. Consider running it only when item_images.checksum is
//   missing for that slug.
// TODO(amverse-variants): Expand `VARIANT_HEADER_MAP` if the live page adds
//   columns we don't recognise (e.g. separate "Ride" / "Fly" columns).
// TODO(amverse-tos): Re-verify terms of service before enabling in prod.
