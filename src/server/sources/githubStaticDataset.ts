import type { RawSourceValue } from "../../shared/normalize";
import type { ItemCategory, Variant } from "../../shared/types";
import {
  fetchJson,
  normalizeSourceValue,
  resolveImageUrl,
  safeAdapter,
} from "./lib";
import type { SourceAdapter } from "./types";

/**
 * GitHub static JSON adapter.
 *
 * Two community-maintained repos can serve as static data sources:
 *
 *   1. ironbabatekkral/adoptme-values  — full(ish) dataset
 *      Default URL:
 *        https://raw.githubusercontent.com/ironbabatekkral/adoptme-values/main/adoptme_values.json
 *
 *   2. Roblox-Services/High-Tier-Adopt-Me-Values — narrower high-tier list
 *      Default URL:
 *        https://raw.githubusercontent.com/Roblox-Services/High-Tier-Adopt-Me-Values/main/pets.json.txt
 *
 * Static GitHub data is _convenient_ but can be stale by days or weeks. We
 * treat it as lower-confidence by always emitting `confidence: "low"` and
 * deferring final confidence to the aggregator's source-count + spread
 * heuristic. The validation pass will refuse to promote a value if GitHub
 * disagrees with the live dataset by more than the threshold.
 *
 * IMPORTANT — Terms of Service:
 *   GitHub-hosted raw files are public, but the underlying datasets may
 *   carry their own licence / attribution requirements. Surface a credit on
 *   the About page if you start relying on these in production.
 *
 * Both fetchers defensively map several common field-name spellings so they
 * survive minor schema drift. Update the maps below if the upstream schema
 * changes shape entirely.
 */

export const IRONBABA_RAW_URL =
  "https://raw.githubusercontent.com/ironbabatekkral/adoptme-values/main/adoptme_values.json";

export const HIGH_TIER_RAW_URL =
  "https://raw.githubusercontent.com/Roblox-Services/High-Tier-Adopt-Me-Values/main/pets.json.txt";

const IRONBABA_SOURCE_NAME = "github_ironbabatekkral";
const HIGH_TIER_SOURCE_NAME = "github_high_tier";

const IRONBABA_IMAGE_BASE =
  "https://raw.githubusercontent.com/ironbabatekkral/adoptme-values/main/";

const VARIANT_KEY_MAP: Record<string, Variant> = {
  normal: "regular",
  regular: "regular",
  ride: "ride",
  fly: "fly",
  fly_ride: "fly_ride",
  flyride: "fly_ride",
  fr: "fly_ride",
  neon: "neon",
  neon_ride: "neon_ride",
  neon_fly: "neon_fly",
  neon_fly_ride: "neon_fly_ride",
  nfr: "neon_fly_ride",
  mega: "mega",
  mega_ride: "mega_ride",
  mega_fly: "mega_fly",
  mega_fly_ride: "mega_fly_ride",
  mfr: "mega_fly_ride",
};

const CATEGORY_MAP: Record<string, ItemCategory> = {
  pet: "pet",
  pets: "pet",
  egg: "egg",
  vehicle: "vehicle",
  toy: "toy",
  stroller: "stroller",
  pet_wear: "pet_wear",
  "pet wear": "pet_wear",
  food: "food",
  gift: "gift",
  potion: "potion",
};

// ─── ironbabatekkral parser ──────────────────────────────────────────────

type IronbabaItem = {
  name?: string;
  category?: string;
  rarity?: string;
  image?: string;
  values?: Record<string, unknown>;
  // Some snapshots use `variants` instead of `values`.
  variants?: Record<string, unknown>;
};

type IronbabaPayload = {
  items?: IronbabaItem[];
  // Some snapshots ship an object map keyed by item name rather than a list.
  [key: string]: unknown;
};

export function parseIronbabaPayload(payload: IronbabaPayload): RawSourceValue[] {
  const items = toItemList(payload);
  const out: RawSourceValue[] = [];

  for (const item of items) {
    if (!item?.name) continue;
    const category = mapCategory(item.category);
    const rarity = item.rarity ?? null;
    const imageUrl = resolveImageUrl(item.image, IRONBABA_IMAGE_BASE);
    const values = item.values ?? item.variants ?? {};

    for (const [rawKey, rawValue] of Object.entries(values)) {
      const variant = VARIANT_KEY_MAP[rawKey.toLowerCase()];
      if (!variant) continue;
      const raw = normalizeSourceValue({
        sourceName: IRONBABA_SOURCE_NAME,
        sourceItemName: item.name,
        rawValue,
        category,
        variant,
        rarity,
        imageUrl,
      });
      if (raw) {
        // GitHub is lower-confidence on purpose; the aggregator + validator
        // already handle this, but we tag the row for traceability.
        raw.confidence = "low";
        out.push(raw);
      }
    }
  }

  return out;
}

function toItemList(payload: IronbabaPayload): IronbabaItem[] {
  if (Array.isArray(payload)) return payload as IronbabaItem[];
  if (Array.isArray(payload.items)) return payload.items;
  // Object map fallback: `{ "Shadow Dragon": {...}, ... }`
  return Object.entries(payload)
    .filter(([key]) => !key.startsWith("_"))
    .map(([name, body]) => {
      if (body && typeof body === "object") {
        return { name, ...(body as IronbabaItem) };
      }
      return { name } as IronbabaItem;
    });
}

function mapCategory(input: string | undefined): ItemCategory {
  if (!input) return "pet";
  return CATEGORY_MAP[input.trim().toLowerCase()] ?? "other";
}

// ─── high-tier parser ────────────────────────────────────────────────────

type HighTierItem = {
  name?: string;
  rarity?: string;
  tier?: string;
  values?: Record<string, unknown>;
};

type HighTierPayload = {
  pets?: HighTierItem[];
  items?: HighTierItem[];
};

export function parseHighTierPayload(payload: HighTierPayload): RawSourceValue[] {
  const items = payload.pets ?? payload.items ?? [];
  const out: RawSourceValue[] = [];
  for (const item of items) {
    if (!item?.name || !item.values) continue;
    for (const [rawKey, rawValue] of Object.entries(item.values)) {
      const variant = VARIANT_KEY_MAP[rawKey.toLowerCase()];
      if (!variant) continue;
      const raw = normalizeSourceValue({
        sourceName: HIGH_TIER_SOURCE_NAME,
        sourceItemName: item.name,
        rawValue,
        category: "pet",
        variant,
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
  /** Also pull the narrow high-tier list. Disabled by default. */
  enableHighTier?: boolean;
  /** Override the raw URLs (useful for tests or self-hosted mirrors). */
  ironbabaUrl?: string;
  highTierUrl?: string;
};

export function buildGithubAdapters(
  options: GithubAdapterOptions = {}
): SourceAdapter[] {
  const adapters: SourceAdapter[] = [
    safeAdapter({
      name: IRONBABA_SOURCE_NAME,
      description:
        "GitHub: ironbabatekkral/adoptme-values (static JSON dataset)",
      enabled: options.enabled,
      fetchValues: async () => {
        const url = options.ironbabaUrl ?? IRONBABA_RAW_URL;
        const payload = await fetchJson<IronbabaPayload>(url);
        return parseIronbabaPayload(payload);
      },
    }),
  ];

  if (options.enableHighTier) {
    adapters.push(
      safeAdapter({
        name: HIGH_TIER_SOURCE_NAME,
        description:
          "GitHub: Roblox-Services/High-Tier-Adopt-Me-Values (narrow high-tier fallback)",
        enabled: true,
        fetchValues: async () => {
          const url = options.highTierUrl ?? HIGH_TIER_RAW_URL;
          const payload = await fetchJson<HighTierPayload>(url);
          return parseHighTierPayload(payload);
        },
      })
    );
  }

  return adapters;
}

// ─── TODOs ────────────────────────────────────────────────────────────────
// TODO(github-freshness): Add a freshness check that downgrades or drops
//   GitHub-sourced values if the upstream file hasn't been updated in N
//   days. The repos expose a commit date in the GitHub API; one extra HEAD
//   request per sync is cheap.
// TODO(github-schema): When the real adoptme_values.json schema is verified
//   live, prune the defensive multi-shape parser back to whatever it
//   actually uses.
// TODO(github-images): The ironbabatekkral repo includes an images folder.
//   Once licence is confirmed, point the image-cache step at
//   IRONBABA_IMAGE_BASE for slugs that we don't have images for yet.
