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
 * The `.org` page is a Next.js app that renders the value list as a grid of
 * `<div class="group grid ...">` rows. We anchor on each row's
 * `<a href="/pets/SLUG">Name</a>` link and then read sibling fields from the
 * surrounding grid:
 *
 *   - Name        — `<a href="/pets/SLUG">…</a>` text
 *   - Image       — `<img alt="Name" src="/Adoptimage/SLUG.png">` (root-relative)
 *   - Rarity      — `<span … bg-amber-500">legendary</span>` (and friends)
 *   - Value       — `<span … text-amber-400">650 RP</span>` (appears twice;
 *                   we read the first occurrence and dedupe)
 *   - Origin      — `<span … md:hidden">Halloween 2019</span>` (egg / source)
 *
 * The page categorises items as Pet / Food / Vehicle / etc via tabs that
 * trigger client-side filtering, so the default landing page returns
 * just one category at a time (currently Pet). To pull other categories we
 * would need to also fetch `/values/?category=…` (left as a TODO).
 *
 * IMPORTANT — Terms of Service:
 *   Verify before enabling for production traffic. Daily cron only, never
 *   from frontend requests. Image hotlinking is NOT permitted — we surface
 *   discovered image URLs for the image-cache step to download into our
 *   own Supabase Storage bucket.
 *
 * IMPORTANT — Fixture parity:
 *   Selectors target `__fixtures__/amtv.values.html`. Refresh the fixture
 *   and selectors together if the live structure changes.
 */

export const AMTV_PRIMARY_URL = "https://adoptmetradingvalues.org/values/";
export const AMTV_SECONDARY_URL =
  "https://adoptmetradingvalues.com/pet-value-list.php?params=everything";

const AMTV_PRIMARY_HOST = "https://adoptmetradingvalues.org";
const AMTV_SECONDARY_HOST = "https://adoptmetradingvalues.com";

const PRIMARY_SOURCE_NAME = "adoptmetradingvalues";
const SECONDARY_SOURCE_NAME = "adoptmetradingvalues_legacy";

const RARITY_CLASS_MAP: Record<string, string> = {
  "bg-amber-500": "legendary",
  "bg-fuchsia-600": "ultra rare",
  "bg-sky-600": "rare",
  "bg-emerald-600": "uncommon",
  "bg-zinc-600": "common",
};

const VALUE_CLASS_HINTS = ["RP"];

function inferCategoryFromUrl(url: string): ItemCategory {
  // The values page exposes one category at a time via the `?category=` query
  // param. Default landing page is "pet".
  const m = url.match(/[?&]category=([^&]+)/i);
  const cat = (m?.[1] ?? "pet").toLowerCase();
  switch (cat) {
    case "pet":
      return "pet";
    case "egg":
      return "egg";
    case "food":
      return "food";
    case "gift":
      return "gift";
    case "petwear":
    case "wing":
      return "pet_wear";
    case "stroller":
      return "stroller";
    case "toy":
    case "sticker":
      return "toy";
    case "vehicle":
      return "vehicle";
    default:
      return "other";
  }
}

export function parseAmtvHtml(
  html: string,
  sourceName: string,
  baseHost: string,
  category: ItemCategory = "pet"
): RawSourceValue[] {
  const $ = cheerio.load(html);
  const out: RawSourceValue[] = [];
  const seenSlugs = new Set<string>();

  // Each pet row carries an <a href="/pets/SLUG">. That's our anchor.
  $('a[href^="/pets/"]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr("href") ?? "";
    const m = href.match(/\/pets\/([^/?#]+)/);
    if (!m) return;
    const slug = m[1];
    if (seenSlugs.has(slug)) return;
    seenSlugs.add(slug);

    const name = $a.text().trim();
    if (!name) return;

    // Walk up to the row container. Each pet sits inside a
    // `<div class="group ...">` grid; the outermost row also has class
    // `group` — find the nearest ancestor that has it.
    const $row = $a.closest("div.group");
    if ($row.length === 0) return;

    const $img = $row.find("img").first();
    const imageUrl = resolveImageUrl($img.attr("src"), baseHost);

    // Rarity: first <span> inside the row whose class includes one of the
    // known bg-… colour tokens.
    let rarity: string | null = null;
    $row.find("span").each((_, span) => {
      if (rarity) return;
      const cls = $(span).attr("class") ?? "";
      for (const [token, label] of Object.entries(RARITY_CLASS_MAP)) {
        if (cls.includes(token)) {
          rarity = label;
          return;
        }
      }
    });

    // Value: first <span> whose text ends with "RP".
    let valueText: string | null = null;
    $row.find("span").each((_, span) => {
      if (valueText) return;
      const t = $(span).text().trim();
      if (VALUE_CLASS_HINTS.some((h) => t.endsWith(h))) {
        valueText = t.replace(/\s*RP\s*$/i, "");
      }
    });

    const raw = normalizeSourceValue({
      sourceName,
      sourceItemName: name,
      rawValue: valueText,
      category,
      variant: "regular", // AMTV publishes one headline value per pet
      rarity,
      imageUrl,
    });
    if (raw) out.push(raw);
  });

  return out;
}

export type AmtvAdapterOptions = {
  enabled?: boolean;
  /**
   * If true, also pull from the legacy `.com` mirror. Off by default to
   * avoid double-counting the same data.
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
        return parseAmtvHtml(
          html,
          PRIMARY_SOURCE_NAME,
          AMTV_PRIMARY_HOST,
          inferCategoryFromUrl(AMTV_PRIMARY_URL)
        );
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
          return parseAmtvHtml(
            html,
            SECONDARY_SOURCE_NAME,
            AMTV_SECONDARY_HOST,
            "pet"
          );
        },
      })
    );
  }

  return adapters;
}

// ─── TODOs ────────────────────────────────────────────────────────────────
// TODO(amtv-categories): The default page only renders the Pet category.
//   To get the full catalog (food, gift, petwear, etc.) we need to fetch
//   the same URL with `?category=<name>` and merge results.
// TODO(amtv-variants): AMTV's "About Pet Values" note states neon ≈ 4×
//   regular and mega neon ≈ 16× regular. We could synthesise neon /
//   mega_neon rows from the regular value, but the multipliers are very
//   rough — better to leave it to AMVerse which publishes them explicitly.
// TODO(amtv-tos & images): Verify image-use terms before enabling caching.
