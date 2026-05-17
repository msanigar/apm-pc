import type { RawSourceValue } from "../../shared/normalize";
import type { ItemCategory } from "../../shared/types";
import { fetchText, normalizeSourceValue, safeAdapter } from "./lib";
import type { SourceAdapter } from "./types";

/**
 * GitHub static data adapter — gizmo.values.
 *
 * The community trading calculator at
 * https://github.com/shabbl3/gizmo.values ships an `index.html` whose
 * `<script>` block declares a JS array that looks like:
 *
 *   const pets = [
 *     { name: 'Bat Dragon',    value: 723,  new: true },
 *     { name: 'Shadow Dragon', value: 560 },
 *     ...
 *   ];
 *
 * It's not strictly JSON, but it _is_ a stable, version-controlled list of
 * Adopt Me pet names with current community-quoted RP values, which is
 * exactly what we want for catalog seeding and as a lower-confidence cross
 * check against the scraped sites. We treat every value as `regular` /
 * "headline" — the calculator uses simple multipliers (×2 neon, ×4 mega,
 * ×1.1 fly, ×1.1 ride) and we deliberately don't synthesise variants from
 * those approximations.
 *
 * IMPORTANT — Provenance / freshness:
 *   shabbl3/gizmo.values is a single maintainer's calculator. Use it as
 *   ONE vote among several, never as the source of truth.
 *
 * IMPORTANT — Licence:
 *   The repo has no LICENSE file. Public mirror of community data; we
 *   include a credit on the About page.
 *
 * The legacy hooks for `ironbabatekkral/adoptme-values` (an empty placeholder
 * repo at time of writing) and `Roblox-Services/High-Tier-Adopt-Me-Values`
 * are kept here as optional fallbacks — wired up but disabled — so the day
 * they ship real data we can flip them on without code changes.
 */

export const GIZMO_RAW_URL =
  "https://raw.githubusercontent.com/shabbl3/gizmo.values/main/index.html";
export const IRONBABA_RAW_URL =
  "https://raw.githubusercontent.com/ironbabatekkral/adoptme-values/main/adoptme_values.json";
export const HIGH_TIER_RAW_URL =
  "https://raw.githubusercontent.com/Roblox-Services/High-Tier-Adopt-Me-Values/main/pets.json.txt";

const GIZMO_SOURCE_NAME = "github_gizmo";
const IRONBABA_SOURCE_NAME = "github_ironbabatekkral";
const HIGH_TIER_SOURCE_NAME = "github_high_tier";

// Items the calculator ships but that we want to classify as non-pets.
const NON_PET_NAME_HINTS: Array<[RegExp, ItemCategory]> = [
  [/\bpotion\b/i, "potion"],
  [/\begg\b/i, "egg"],
  [/\bgift\b/i, "gift"],
  [/\bstroller\b/i, "stroller"],
  [/\b(scooter|airboat|board|car|truck|bike)\b/i, "vehicle"],
  // Same end-anchored "actually-a-food-item" heuristic as the AMVerse adapter.
  // Keep these in sync with src/server/sources/amverse.ts inferCategory().
  [
    /\b(cake|cookie|brownie|donut|doughnut|cupcake|pancake|waffle|muffin|tart|pie|pudding|jellybean|lollipop|popsicle|gumball|sundae|sorbet|burger|fries|nugget|nuggets|sushi|salad|taco|burrito|wrap|bread|pizza)$/i,
    "food",
  ],
  [/^(slice of|bowl of|plate of) /i, "food"],
  [
    /\b(hat|headset|glasses|crown|necklace|bag|hood|sword|propeller|wings?|halo|hoverboard)\b/i,
    "pet_wear",
  ],
];

function classifyName(name: string): ItemCategory {
  for (const [pattern, cat] of NON_PET_NAME_HINTS) {
    if (pattern.test(name)) return cat;
  }
  return "pet";
}

// ─── gizmo.values parser ─────────────────────────────────────────────────

/**
 * Extracts the `const pets = [ ... ];` block from the gizmo.values HTML.
 * Uses a defensive regex that does NOT eval — we only accept the limited
 * subset of JS object syntax the file actually uses.
 *
 * Each parsed entry produces a single `RawSourceValue` with
 * `variant = "regular"` (the calculator stores a single base value per pet).
 */
export function parseGizmoHtml(html: string): RawSourceValue[] {
  const arrMatch = html.match(/const\s+pets\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (!arrMatch) return [];

  const body = arrMatch[1];
  const entryRegex =
    /\{\s*name\s*:\s*(['"])([^'"\\]+)\1\s*,\s*value\s*:\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*new\s*:\s*(true|false))?\s*\}/g;

  const out: RawSourceValue[] = [];
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(body)) !== null) {
    const name = m[2];
    const value = Number.parseFloat(m[3]);
    if (!Number.isFinite(value)) continue;

    const category = classifyName(name);
    const raw = normalizeSourceValue({
      sourceName: GIZMO_SOURCE_NAME,
      sourceItemName: name,
      rawValue: value,
      category,
      variant: "regular",
      rarity: null,
      imageUrl: undefined,
    });
    if (raw) {
      raw.confidence = "low";
      out.push(raw);
    }
  }
  return out;
}

// ─── ironbabatekkral parser (defensive, still scaffold-shaped) ───────────
//
// The repo is currently empty. We keep a permissive parser so that if the
// maintainer publishes data with any of the common shapes (`{ items: [...]}`
// or a top-level object map), we can pick it up without a code change.

type IronbabaItem = {
  name?: string;
  category?: string;
  rarity?: string;
  values?: Record<string, number | string>;
};

const VARIANT_KEY_MAP: Record<string, string> = {
  normal: "regular",
  regular: "regular",
  fly: "fly",
  ride: "ride",
  fr: "fly_ride",
  fly_ride: "fly_ride",
  neon: "neon",
  nfr: "neon_fly_ride",
  neon_fly_ride: "neon_fly_ride",
  mega: "mega",
  mfr: "mega_fly_ride",
  mega_fly_ride: "mega_fly_ride",
};

export function parseIronbabaPayload(payload: unknown): RawSourceValue[] {
  const items = toIronbabaList(payload);
  const out: RawSourceValue[] = [];
  for (const item of items) {
    if (!item?.name || !item.values) continue;
    for (const [key, rawValue] of Object.entries(item.values)) {
      const variantName = VARIANT_KEY_MAP[key.toLowerCase()];
      if (!variantName) continue;
      const raw = normalizeSourceValue({
        sourceName: IRONBABA_SOURCE_NAME,
        sourceItemName: item.name,
        rawValue,
        category: (item.category as ItemCategory) ?? "pet",
        variant: variantName as RawSourceValue["variant"],
        rarity: item.rarity ?? null,
      });
      if (raw) {
        raw.confidence = "low";
        out.push(raw);
      }
    }
  }
  return out;
}

function toIronbabaList(payload: unknown): IronbabaItem[] {
  if (Array.isArray(payload)) return payload as IronbabaItem[];
  if (payload && typeof payload === "object") {
    const p = payload as { items?: IronbabaItem[] };
    if (Array.isArray(p.items)) return p.items;
    return Object.entries(payload as Record<string, IronbabaItem>)
      .filter(([k]) => !k.startsWith("_"))
      .map(([name, body]) =>
        body && typeof body === "object" ? { name, ...body } : { name }
      );
  }
  return [];
}

type HighTierPayload = { pets?: IronbabaItem[]; items?: IronbabaItem[] };

export function parseHighTierPayload(payload: HighTierPayload): RawSourceValue[] {
  const list = payload.pets ?? payload.items ?? [];
  const out: RawSourceValue[] = [];
  for (const item of list) {
    if (!item?.name || !item.values) continue;
    for (const [key, rawValue] of Object.entries(item.values)) {
      const variantName = VARIANT_KEY_MAP[key.toLowerCase()];
      if (!variantName) continue;
      const raw = normalizeSourceValue({
        sourceName: HIGH_TIER_SOURCE_NAME,
        sourceItemName: item.name,
        rawValue,
        category: "pet",
        variant: variantName as RawSourceValue["variant"],
        rarity: item.rarity ?? null,
      });
      if (raw) {
        raw.confidence = "low";
        out.push(raw);
      }
    }
  }
  return out;
}

// ─── Adapters ────────────────────────────────────────────────────────────

export type GithubAdapterOptions = {
  enabled?: boolean;
  /** Also pull ironbabatekkral (currently empty placeholder repo). */
  enableIronbaba?: boolean;
  /** Also pull the narrow high-tier list. Off by default. */
  enableHighTier?: boolean;
  gizmoUrl?: string;
  ironbabaUrl?: string;
  highTierUrl?: string;
};

export function buildGithubAdapters(
  options: GithubAdapterOptions = {}
): SourceAdapter[] {
  const adapters: SourceAdapter[] = [
    safeAdapter({
      name: GIZMO_SOURCE_NAME,
      description:
        "GitHub: shabbl3/gizmo.values (embedded pets array in index.html)",
      enabled: options.enabled,
      fetchValues: async () => {
        const html = await fetchText(options.gizmoUrl ?? GIZMO_RAW_URL);
        return parseGizmoHtml(html);
      },
    }),
  ];

  if (options.enableIronbaba) {
    adapters.push(
      safeAdapter({
        name: IRONBABA_SOURCE_NAME,
        description:
          "GitHub: ironbabatekkral/adoptme-values (currently empty placeholder)",
        enabled: true,
        fetchValues: async () => {
          const text = await fetchText(
            options.ironbabaUrl ?? IRONBABA_RAW_URL
          );
          // 404s come back as empty text from `safeFetch`; bail gracefully.
          if (!text.trim()) return [];
          const payload = JSON.parse(text);
          return parseIronbabaPayload(payload);
        },
      })
    );
  }

  if (options.enableHighTier) {
    adapters.push(
      safeAdapter({
        name: HIGH_TIER_SOURCE_NAME,
        description:
          "GitHub: Roblox-Services/High-Tier-Adopt-Me-Values (narrow high-tier fallback)",
        enabled: true,
        fetchValues: async () => {
          const text = await fetchText(
            options.highTierUrl ?? HIGH_TIER_RAW_URL
          );
          if (!text.trim()) return [];
          const payload = JSON.parse(text) as HighTierPayload;
          return parseHighTierPayload(payload);
        },
      })
    );
  }

  return adapters;
}

// ─── TODOs ────────────────────────────────────────────────────────────────
// TODO(github-freshness): Hit the GitHub commits API once per sync to drop
//   gizmo data if the file hasn't moved in >30 days.
// TODO(github-variants): The gizmo calculator publishes only a base value
//   and applies simple multipliers. We deliberately don't extrapolate
//   variant values here because the spread vs. real community values is
//   too high. AMVerse and AMTV are authoritative for variants.
