import type { Variant } from "./types";

/**
 * Result of parsing a free-text search query.
 *
 * `normalizedQuery` is the query with any variant prefix stripped, lowercased,
 * and collapsed whitespace. It is what we feed to Fuse.js.
 *
 * `requestedVariant` is set when the user typed an explicit variant token like
 * "FR", "neon fly", "MFR", etc. It is `undefined` when the query does not
 * specify a variant.
 *
 * Important: "Ride Potion" and "Fly Potion" are actual items, not pet
 * variants. The parser must not strip those.
 */
export type ParsedSearchQuery = {
  rawQuery: string;
  normalizedQuery: string;
  requestedVariant?: Variant;
};

/**
 * Names of items where words like "ride", "fly", "neon" or "mega" form part of
 * the item's own name and must not be parsed as a variant prefix.
 *
 * Match is performed case-insensitively against the lowercased query string.
 */
const VARIANT_LITERAL_ITEMS = [
  "ride potion",
  "fly potion",
  "neon potion",
  "mega neon potion",
  "neonpotion",
  "flypotion",
  "ridepotion",
];

/**
 * Abbreviation → variant lookup.
 * Order matters only when iterating; we always check the longest match first.
 */
const VARIANT_ABBREVIATIONS: Record<string, Variant> = {
  mfr: "mega_fly_ride",
  mnfr: "mega_fly_ride", // sometimes typed as Mega Neon Fly Ride
  nfr: "neon_fly_ride",
  mr: "mega_ride",
  mf: "mega_fly",
  nr: "neon_ride",
  nf: "neon_fly",
  fr: "fly_ride",
  m: "mega",
  n: "neon",
  f: "fly",
  r: "ride",
};

/**
 * Spelled-out word sequences that map to a variant. We normalise multi-word
 * spellings to use spaces. Order matters: longer sequences must come first so
 * "neon fly ride" wins over "fly ride".
 */
const VARIANT_WORDS: Array<{ words: string[]; variant: Variant }> = [
  { words: ["mega", "neon", "fly", "ride"], variant: "mega_fly_ride" },
  { words: ["mega", "fly", "ride"], variant: "mega_fly_ride" },
  { words: ["mega", "neon", "fly"], variant: "mega_fly" },
  { words: ["mega", "neon", "ride"], variant: "mega_ride" },
  { words: ["mega", "neon"], variant: "mega" },
  { words: ["mega", "ride"], variant: "mega_ride" },
  { words: ["mega", "fly"], variant: "mega_fly" },
  { words: ["neon", "fly", "ride"], variant: "neon_fly_ride" },
  { words: ["neon", "ride"], variant: "neon_ride" },
  { words: ["neon", "fly"], variant: "neon_fly" },
  { words: ["fly", "ride"], variant: "fly_ride" },
  { words: ["mega"], variant: "mega" },
  { words: ["neon"], variant: "neon" },
  { words: ["fly"], variant: "fly" },
  { words: ["ride"], variant: "ride" },
];

function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function containsLiteralVariantItem(loweredQuery: string): boolean {
  return VARIANT_LITERAL_ITEMS.some((literal) =>
    loweredQuery.includes(literal)
  );
}

/**
 * Try to strip a leading variant abbreviation like "fr", "nfr", "mfr" from the
 * tokens array. Returns the matched variant and the remaining tokens, or
 * null if no abbreviation prefix is found.
 */
function stripAbbreviationPrefix(
  tokens: string[]
): { variant: Variant; rest: string[] } | null {
  if (tokens.length < 2) return null;
  const first = tokens[0].toLowerCase();
  const variant = VARIANT_ABBREVIATIONS[first];
  if (!variant) return null;
  return { variant, rest: tokens.slice(1) };
}

/**
 * Try to strip a leading variant word sequence like ["fly","ride"] or
 * ["mega","ride"] from the tokens array.
 */
function stripWordPrefix(
  tokens: string[]
): { variant: Variant; rest: string[] } | null {
  if (tokens.length < 2) return null;
  const lowered = tokens.map((t) => t.toLowerCase());
  for (const { words, variant } of VARIANT_WORDS) {
    if (lowered.length <= words.length) continue;
    let matches = true;
    for (let i = 0; i < words.length; i++) {
      if (lowered[i] !== words[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return { variant, rest: tokens.slice(words.length) };
    }
  }
  return null;
}

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const rawQuery = input ?? "";
  const trimmed = normaliseWhitespace(rawQuery.toLowerCase());

  if (!trimmed) {
    return { rawQuery, normalizedQuery: "" };
  }

  // Never treat "ride potion" / "fly potion" etc. as variant prefixes.
  if (containsLiteralVariantItem(trimmed)) {
    return { rawQuery, normalizedQuery: trimmed };
  }

  const tokens = trimmed.split(" ").filter(Boolean);

  // Prefer multi-word spelled-out prefixes ("fly ride", "mega ride", ...).
  const wordMatch = stripWordPrefix(tokens);
  if (wordMatch) {
    return {
      rawQuery,
      normalizedQuery: normaliseWhitespace(wordMatch.rest.join(" ")),
      requestedVariant: wordMatch.variant,
    };
  }

  // Fall back to single-token abbreviations ("fr shadow drag", "nfr owl").
  const abbrMatch = stripAbbreviationPrefix(tokens);
  if (abbrMatch) {
    return {
      rawQuery,
      normalizedQuery: normaliseWhitespace(abbrMatch.rest.join(" ")),
      requestedVariant: abbrMatch.variant,
    };
  }

  return { rawQuery, normalizedQuery: trimmed };
}
