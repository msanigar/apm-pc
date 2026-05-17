import { parseSearchQuery } from "./parseSearchQuery";
import { toSlug } from "./slug";
import type {
  CandidateDataset,
  CandidateRow,
  ItemCategory,
  Variant,
} from "./types";

export type RawSourceValue = {
  sourceName: string;
  sourceItemName: string;
  category?: ItemCategory;
  variant?: Variant;
  valueRp: number;
  demand?: number;
  confidence?: string;
  imageUrl?: string;
};

export type NormalizedSourceValue = {
  sourceName: string;
  sourceItemName: string;
  itemSlug: string;
  itemName: string;
  category: ItemCategory;
  variant: Variant;
  valueRp: number;
  imageUrl?: string;
};

/**
 * Catalog used to canonicalise source names. Maps a lowercased name OR alias
 * to the canonical slug. Built from the items catalog by the sync pipeline.
 *
 * Without this, two sources that disagree on naming ("Shadow Drag" vs "Shadow
 * Dragon") would end up as two different items, defeating the median
 * aggregator.
 */
export type AliasMap = Map<string, string>;

export function buildAliasMap(
  items: ReadonlyArray<{ slug: string; name: string; aliases?: string[] }>
): AliasMap {
  const map: AliasMap = new Map();
  for (const item of items) {
    map.set(item.name.toLowerCase(), item.slug);
    map.set(item.slug.replace(/-/g, " "), item.slug);
    for (const alias of item.aliases ?? []) {
      map.set(alias.toLowerCase(), item.slug);
    }
  }
  return map;
}

/**
 * Normalise raw source values into canonical (slug, variant) rows.
 *
 * - If the source provides an explicit variant, we trust it.
 * - Otherwise, we run the variant parser over the source's item name to lift
 *   any prefix like "FR Shadow Dragon" into (item: shadow-dragon, variant:
 *   fly_ride). This way sources don't have to agree on naming conventions.
 * - Names are canonicalised through the alias map when provided, so
 *   "Shadow Drag" maps to the same slug as "Shadow Dragon".
 * - Negative or zero values are dropped (sources occasionally publish 0 to
 *   mean "unknown" — we don't want that polluting the median).
 */
export function normalizeSourceValues(
  raw: RawSourceValue[],
  aliases?: AliasMap
): NormalizedSourceValue[] {
  const out: NormalizedSourceValue[] = [];
  for (const r of raw) {
    if (!r.sourceItemName || typeof r.valueRp !== "number") continue;
    if (!Number.isFinite(r.valueRp) || r.valueRp <= 0) continue;

    // Always run the query parser so we strip any variant prefix that may
    // also be embedded in the name, even when the source provides a separate
    // explicit variant field. If both are present, we trust the explicit one.
    const parsed = parseSearchQuery(r.sourceItemName);
    const variant: Variant =
      r.variant ?? parsed.requestedVariant ?? "regular";
    let cleanName = parsed.normalizedQuery || r.sourceItemName;

    const lookupKey = cleanName.toLowerCase();
    const canonicalSlug = aliases?.get(lookupKey);
    const itemSlug = canonicalSlug ?? toSlug(cleanName);
    cleanName = titleCase(cleanName);

    out.push({
      sourceName: r.sourceName,
      sourceItemName: r.sourceItemName,
      itemSlug,
      itemName: cleanName,
      category: r.category ?? "pet",
      variant,
      valueRp: r.valueRp,
      imageUrl: r.imageUrl,
    });
  }
  return out;
}

/**
 * Group normalised values from many sources into a single candidate dataset
 * keyed on (itemSlug, variant).
 */
export function buildCandidateDataset(
  values: NormalizedSourceValue[]
): CandidateDataset {
  const rows = new Map<string, CandidateRow>();
  const sources = new Set<string>();

  for (const v of values) {
    const key = `${v.itemSlug}::${v.variant}`;
    sources.add(v.sourceName);
    let row = rows.get(key);
    if (!row) {
      row = {
        itemSlug: v.itemSlug,
        variant: v.variant,
        values: [],
        sources: [],
      };
      rows.set(key, row);
    }
    // Each source can only contribute one value per (item, variant).
    if (row.sources.includes(v.sourceName)) continue;
    row.values.push(v.valueRp);
    row.sources.push(v.sourceName);
  }

  return {
    rows: Array.from(rows.values()),
    sourceNames: Array.from(sources),
  };
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
