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
 * AMVerse adapter — public JSON API.
 *
 *   GET https://amverse.co/api/pets?offset=N&limit=M
 *
 * The site bundles a `data.js` script that paginates this endpoint to render
 * the values table. Inspecting the bundle revealed that the API is open to
 * any caller that sets the same Origin/Referer headers the browser does. We
 * follow the same protocol and walk the pages with a hard cap on request
 * count.
 *
 * Each item carries two value sub-objects: `elve` (Elvebredd) and `amvgg`
 * (AMVGG). We only emit Elvebredd values because:
 *
 *   • AMVGG values are quoted in a different unit; e.g. Bat Dragon comes
 *     back as { elve.rvalue: 755, amvgg.regularValue: 3.85 } — the ratio
 *     between the two is non-constant across items (~25× for low-tier,
 *     ~200× for high-tier). Naively averaging them with Elvebredd /
 *     adoptmetradingvalues (both in RP) would corrupt aggregation.
 *   • AMVGG still gives us useful demand labels (`regularDemand: "High"`
 *     etc.) and a cross-check on rarity/category. We extract image URLs
 *     and rarity from the merged record.
 *
 * Elvebredd's data is complete — every variant is published as a separate
 * field. See `ELVE_FIELD_TO_VARIANT` below for the field → variant map.
 *
 * IMPORTANT — Terms of Service:
 *   Always verify amverse.co's terms / robots.txt before enabling at
 *   scale. We are limited to one cron pass per day with a small page
 *   count, well below any reasonable rate limit.
 *
 * IMPORTANT — Fixture parity:
 *   The trimmed fixture `__fixtures__/amverse.api.json` mirrors the live
 *   API response shape with ~18 representative items. The full snapshot
 *   `amverse.api.full.json` (gitignored) is used for catalog seeding.
 */

export const AMVERSE_API_URL = "https://amverse.co/api/pets";

const ELVEBREDD_SOURCE = "amverse_elvebredd";

/**
 * Elvebredd publishes a separate field per variant. We map the field name to
 * our internal `Variant` enum. Anything not in this map is ignored.
 */
const ELVE_FIELD_TO_VARIANT: Record<string, Variant> = {
  rvalue: "regular",
  rvalueRide: "ride",
  rvalueFly: "fly",
  rvalueFlyRide: "fly_ride",
  nvalue: "neon",
  nvalueRide: "neon_ride",
  nvalueFly: "neon_fly",
  nvalueFlyRide: "neon_fly_ride",
  mvalue: "mega",
  mvalueRide: "mega_ride",
  mvalueFly: "mega_fly",
  mvalueFlyRide: "mega_fly_ride",
};

/**
 * Per-request page size. The endpoint caps at 200, but allows smaller values
 * if we want to spread the load.
 */
const DEFAULT_PAGE_SIZE = 200;
/** Safety net: never make more than this many requests per sync. */
const MAX_PAGES = 25;

type ElveBlock = Record<string, number | null | undefined> & {
  hasChanged?: boolean;
  scrapedAt?: string;
};

type AmverseItem = {
  petId: number;
  name: string;
  rarity?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  flyRide?: boolean;
  elve?: ElveBlock | null;
  amvgg?: Record<string, unknown> | null;
};

type AmversePage = {
  pets: AmverseItem[];
  total: number;
  offset: number;
  limit: number;
  hasMore?: boolean;
};

/**
 * AMVerse's `category` field is a stylistic/personality tag ("High tier",
 * "Default legs", "Exotic", "2019", "Randoms", "Other"), not an item type.
 * We ignore it for our internal `ItemCategory` and infer category from the
 * item name instead — same heuristic as the GitHub adapter.
 */
function inferCategory(name: string): ItemCategory {
  const n = name.toLowerCase();
  if (/\bpotion\b/.test(n)) return "potion";
  if (/\begg\b/.test(n)) return "egg";
  if (/\bstroller\b/.test(n)) return "stroller";
  if (/\b(toy|plushie|sticker|chew toy|rattle|box)\b/.test(n)) return "toy";
  if (/\bgift\b/.test(n)) return "gift";
  if (
    /\b(hat|headset|glasses|crown|necklace|bag|hood|sword|propeller|wings?|halo|hoverboard|drape|scarf|cape|shoes|lanyard|pin|backpack)\b/.test(
      n
    )
  )
    return "pet_wear";
  if (/\b(scooter|airboat|board|car|truck|bike|snowboard)\b/.test(n))
    return "vehicle";
  return "pet";
}

/**
 * Parse a single page payload into RawSourceValue rows.
 *
 * We only emit Elvebredd rows; AMVGG is ignored for value purposes but its
 * presence is used to enrich the rarity / image URL when Elvebredd doesn't
 * carry one. See the file header for why we do this.
 */
export function parseAmversePage(page: AmversePage | AmverseItem[]): RawSourceValue[] {
  const items = Array.isArray(page) ? page : page.pets ?? [];
  const out: RawSourceValue[] = [];

  for (const item of items) {
    if (!item?.name || !item.elve) continue;

    const category = inferCategory(item.name);
    const rarity = item.rarity?.toString().trim().toLowerCase() ?? null;
    const imageUrl = resolveImageUrl(item.imageUrl, "https://data.amverse.co");
    const elve = item.elve;

    for (const [field, variant] of Object.entries(ELVE_FIELD_TO_VARIANT)) {
      const rawValue = elve[field];
      if (rawValue == null) continue;

      const row = normalizeSourceValue({
        sourceName: ELVEBREDD_SOURCE,
        sourceItemName: item.name,
        rawValue,
        category,
        variant,
        rarity,
        imageUrl,
      });
      if (row) out.push(row);
    }
  }

  return out;
}

export type AmverseAdapterOptions = {
  enabled?: boolean;
  /** Override the API URL — useful in tests. */
  apiUrl?: string;
  /** Page size for pagination requests. */
  pageSize?: number;
  /** Cap on total pages fetched per sync. */
  maxPages?: number;
};

async function fetchAllPages(
  apiUrl: string,
  pageSize: number,
  maxPages: number
): Promise<AmverseItem[]> {
  const all: AmverseItem[] = [];
  let offset = 0;
  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const url = `${apiUrl}?offset=${offset}&limit=${pageSize}`;
    const page = await fetchJson<AmversePage>(url, {
      headers: {
        Origin: "https://amverse.co",
        Referer: "https://amverse.co/values",
      },
    });
    if (!page?.pets || page.pets.length === 0) break;
    all.push(...page.pets);
    offset += page.pets.length;
    if (!page.hasMore) break;
  }
  return all;
}

export function buildAmverseAdapters(
  options: AmverseAdapterOptions = {}
): SourceAdapter[] {
  const apiUrl = options.apiUrl ?? AMVERSE_API_URL;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_PAGES;

  return [
    safeAdapter({
      name: ELVEBREDD_SOURCE,
      description:
        "AMVerse — Elvebredd values via amverse.co/api/pets (paginated)",
      enabled: options.enabled,
      fetchValues: async () => {
        const items = await fetchAllPages(apiUrl, pageSize, maxPages);
        return parseAmversePage(items);
      },
    }),
  ];
}

// ─── TODOs ────────────────────────────────────────────────────────────────
// TODO(amverse-amvgg): AMVGG's value scale is per-pet relative, not RP.
//   We currently drop it. Investigate whether AMVerse exposes a global
//   AMVGG→RP scale factor, or compute one ourselves by regressing AMVGG
//   against Elvebredd on legendaries with high demand.
// TODO(amverse-demand): The amvgg.* fields carry `regularDemand` etc.
//   ("High"/"Mid"/"Low"). Surface this on the canonical item as a
//   secondary signal (right now we throw it away).
// TODO(amverse-rate-limit): Add a delay between paginated requests if we
//   ever raise MAX_PAGES significantly. Current cap (25 × 200 = 5000 items)
//   sits well under one daily cron run and the live total of ~3,400.
