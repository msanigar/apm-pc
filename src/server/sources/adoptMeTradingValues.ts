import * as cheerio from "cheerio";
import type { RawSourceValue } from "../../shared/normalize";
import type { ItemCategory } from "../../shared/types";
import {
  fetchText,
  normalizeSourceValue,
  resolveImageUrl,
  safeAdapter,
} from "./lib";
import type { SourceAdapter } from "./types";

/**
 * Adopt Me Trading Values adapter.
 *
 * Canonical page:        https://adoptmetradingvalues.org/values/
 * Secondary candidate:   https://adoptmetradingvalues.com/pet-value-list.php?params=everything
 *
 * Both sites publish a single value table per page. Values are quoted in RP
 * ("Ride Potions"), which is also our canonical unit, so no conversion is
 * needed. We start with the `.org` page; the `.com` page is registered but
 * disabled behind `ENABLE_AMTV_DOTCOM` because it appears to be a thinner /
 * older mirror and we don't want to over-weight what's effectively the same
 * data source.
 *
 * IMPORTANT — Terms of Service:
 *   Verify the site terms before enabling. Daily-cron access only, never
 *   from frontend requests. Image hotlinking is NOT allowed — we pass any
 *   discovered image URL through as `imageUrl` so the image-cache step can
 *   download it into Supabase Storage instead.
 *
 * IMPORTANT — Fixture parity:
 *   Selectors target `__fixtures__/amtv.values.html`. The real DOM may be
 *   different; update both together when you verify against the live page.
 */

export const AMTV_PRIMARY_URL = "https://adoptmetradingvalues.org/values/";
export const AMTV_SECONDARY_URL =
  "https://adoptmetradingvalues.com/pet-value-list.php?params=everything";

const AMTV_PRIMARY_HOST = "https://adoptmetradingvalues.org";
const AMTV_SECONDARY_HOST = "https://adoptmetradingvalues.com";

const PRIMARY_SOURCE_NAME = "adoptmetradingvalues";
const SECONDARY_SOURCE_NAME = "adoptmetradingvalues_legacy";

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
  petwear: "pet_wear",
  "pet-wear": "pet_wear",
  food: "food",
  gift: "gift",
  gifts: "gift",
  potion: "potion",
  potions: "potion",
};

export function parseAmtvHtml(
  html: string,
  sourceName: string,
  baseHost: string
): RawSourceValue[] {
  const $ = cheerio.load(html);
  const out: RawSourceValue[] = [];

  // The selector below is intentionally generous: it accepts any <table>
  // that has an `.item-row` body, OR a table whose header includes a
  // recognisable "Value" column. Tighten this once we verify the live DOM.
  let $rows = $("table.value-list tbody tr.item-row");
  if ($rows.length === 0) {
    $rows = $("table tbody tr").filter((_, tr) => {
      return $(tr).find("td").length >= 3;
    });
  }

  $rows.each((_, tr) => {
    const $tr = $(tr);
    const $cells = $tr.find("td");
    if ($cells.length < 3) return;

    // Cell layout (per fixture): [thumbnail][name][category][rarity][value]
    const imgSrc = $cells.eq(0).find("img").attr("src");
    const name = $cells.eq(1).text().trim();
    const categoryText = $cells.eq(2).text().trim();
    const rarity = $cells.eq(3).text().trim() || null;
    const valueText = $cells.eq($cells.length - 1).text().trim();

    if (!name) return;

    const raw = normalizeSourceValue({
      sourceName,
      sourceItemName: name,
      rawValue: valueText,
      category: mapCategory(categoryText),
      // AMTV publishes "regular" values per item — they don't enumerate the
      // 12-variant matrix. The variant parser inside `normalizeSourceValues`
      // (called by the sync pipeline) will still lift any "FR " prefix off
      // the name when present.
      variant: "regular",
      rarity,
      imageUrl: resolveImageUrl(imgSrc, baseHost),
    });
    if (raw) out.push(raw);
  });

  return out;
}

function mapCategory(input: string): ItemCategory {
  if (!input) return "pet";
  return CATEGORY_MAP[input.trim().toLowerCase()] ?? "other";
}

export type AmtvAdapterOptions = {
  enabled?: boolean;
  /**
   * If true, also pull from the legacy `.com` page. Off by default to avoid
   * double-counting effectively the same data. Toggle via env in the
   * registry (see `src/server/sources/index.ts`).
   */
  enableLegacyMirror?: boolean;
};

export function buildAmtvAdapter(options: AmtvAdapterOptions = {}): SourceAdapter[] {
  const adapters: SourceAdapter[] = [
    safeAdapter({
      name: PRIMARY_SOURCE_NAME,
      description: "Adopt Me Trading Values (adoptmetradingvalues.org)",
      enabled: options.enabled,
      fetchValues: async () => {
        const html = await fetchText(AMTV_PRIMARY_URL);
        return parseAmtvHtml(html, PRIMARY_SOURCE_NAME, AMTV_PRIMARY_HOST);
      },
    }),
  ];

  if (options.enableLegacyMirror) {
    adapters.push(
      safeAdapter({
        name: SECONDARY_SOURCE_NAME,
        description:
          "Adopt Me Trading Values legacy mirror (adoptmetradingvalues.com)",
        enabled: true,
        fetchValues: async () => {
          const html = await fetchText(AMTV_SECONDARY_URL);
          return parseAmtvHtml(html, SECONDARY_SOURCE_NAME, AMTV_SECONDARY_HOST);
        },
      })
    );
  }

  return adapters;
}

// ─── TODOs ────────────────────────────────────────────────────────────────
// TODO(amtv-variants): If the live page splits regular/neon/mega across
//   columns or separate tables, generalise `parseAmtvHtml` to a multi-column
//   parser (see the AMVerse adapter for an example).
// TODO(amtv-images): Verify image-use terms before enabling image caching
//   for this source. The current code surfaces an `imageUrl` so the cache
//   step can pick it up, but until terms are confirmed, leave the cache
//   step a no-op for this source.
// TODO(amtv-legacy): Decide whether to keep the `.com` mirror long-term, or
//   drop it once `.org` proves reliable on its own.
