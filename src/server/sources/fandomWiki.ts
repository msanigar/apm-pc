/**
 * Fandom (Adopt Me Wiki) adapter.
 *
 *   GET https://adoptme.fandom.com/api.php?action=query&list=categorymembers&...
 *   GET https://adoptme.fandom.com/api.php?action=parse&page={Title}&prop=wikitext|revid
 *
 * This module handles three related wiki extraction jobs:
 *
 *   • EGG HATCHING       — Category:Eggs pages have a shared `{{Eggs|...}}`
 *                          infobox with per-tier odds, plus an "Obtainable
 *                          Pets" wikitable.
 *
 *   • BOX / GIFT CONTENTS — Category:Gifts pages reuse the same `{{Eggs}}`
 *                          template + table structure (RGB Reward Box etc.),
 *                          we just store the rows in `item_contents` instead
 *                          of `egg_hatch_pets`.
 *
 *   • PET ACQUISITION    — A pet's wiki page lede paragraph describes how it
 *                          entered the game (event, Robux purchase, …). We
 *                          extract this with conservative prose regexes for
 *                          the non-egg-hatch case (Cerberus, Bat Dragon, …).
 *
 * IMPORTANT — Terms of Service:
 *   `https://adoptme.fandom.com/robots.txt` explicitly allows `/api.php?`
 *   paths for generic crawlers. We still treat the API politely:
 *     • daily cadence (cron-driven, never per-request),
 *     • small concurrency (sequential by default),
 *     • a friendly UA via `safeFetch` (see `lib.ts`).
 *
 * IMPORTANT — Wikitext fragility:
 *   Templates + table format are well-established but not enforced. The
 *   parsers are forgiving (missing template / table / prose pattern → no
 *   data) so a malformed page only loses that item's data, not the run.
 */
import { toSlug } from "../../shared/slug";
import { fetchJson } from "./lib";

const FANDOM_BASE = "https://adoptme.fandom.com";
const API_URL = `${FANDOM_BASE}/api.php`;

export const FANDOM_SOURCE = "fandom_wiki";

export type HatchRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "ultra_rare"
  | "legendary";

export type EggHatchOddsRow = {
  eggTitle: string;
  eggSlug: string;
  rarity: HatchRarity;
  probabilityPct: number | null;
  source: string;
  sourceRevisionId: string | null;
};

export type EggHatchPetRow = {
  eggTitle: string;
  eggSlug: string;
  petTitle: string;
  petDisplayName: string;
  petSlug: string;
  rarity: HatchRarity;
  source: string;
  sourceRevisionId: string | null;
};

export type FandomHatchPayload = {
  odds: EggHatchOddsRow[];
  pets: EggHatchPetRow[];
  fetchedAt: string;
  eggCount: number;
};

/* ───────────────────── slug + rarity helpers ───────────────────── */

/**
 * Convert a wiki page title to our catalog slug.
 *
 *   "Mythic Egg"      → "mythic-egg"
 *   "Phoenix (Pet)"   → "phoenix"
 *   "Pet Egg"         → "pet-egg"
 *
 * Parenthetical disambiguation suffixes are stripped because our catalog
 * keys on the plain pet name. The wiki uses "Phoenix (Pet)" to disambiguate
 * from "Phoenix (NPC)"; we only care about the pet.
 */
export function pageTitleToSlug(title: string): string {
  return toSlug(title.replace(/\s*\(.+?\)\s*$/, "").trim());
}

const RARITY_NORMALISE: Record<string, HatchRarity> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  "ultra rare": "ultra_rare",
  "ultra-rare": "ultra_rare",
  ultrarare: "ultra_rare",
  legendary: "legendary",
};

function normaliseRarity(s: string): HatchRarity | null {
  const cleaned = s
    .replace(/<[^>]+>/g, "") // strip any HTML
    .replace(/\[\[[^\]]+\]\]/g, (m) => {
      // Keep the display text of a wiki link.
      const inner = m.slice(2, -2);
      const pipe = inner.lastIndexOf("|");
      return pipe >= 0 ? inner.slice(pipe + 1) : inner;
    })
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ");
  return RARITY_NORMALISE[cleaned] ?? null;
}

function parsePct(s: string | undefined | null): number | null {
  if (s == null) return null;
  const trimmed = s.trim().replace(/[%\s]/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/* ───────────────────── wikitext parsing ───────────────────── */

/**
 * Extract the fields from the `{{Eggs|key=value|...}}` infobox.
 *
 * Returns a Map keyed on lowercased field name, or `null` if no `{{Eggs}}`
 * template is present.
 */
export function parseEggsInfobox(wikitext: string): Map<string, string> | null {
  const re = /\{\{Eggs[\s|}]/i;
  const m = wikitext.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index;

  // Find the matching `}}`, accounting for nested templates like `{{Bucks|750}}`.
  let depth = 0;
  let end = -1;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === "{" && wikitext[i + 1] === "{") {
      depth += 1;
      i += 1;
    } else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 2;
        break;
      }
      i += 1;
    }
  }
  if (end < 0) return null;

  const inner = wikitext.slice(start + 2, end - 2);
  const parts = splitTopLevel(inner, "|");
  if (parts.length === 0) return null;

  // parts[0] is "Eggs" (template name); skip.
  const fields = new Map<string, string>();
  for (const raw of parts.slice(1)) {
    const eq = raw.indexOf("=");
    if (eq < 0) continue;
    const key = raw.slice(0, eq).trim().toLowerCase();
    const value = raw.slice(eq + 1).trim();
    if (key) fields.set(key, value);
  }
  return fields;
}

/**
 * Split a string on a separator at the top level, ignoring instances that
 * appear inside `[[...]]` links or `{{...}}` templates.
 */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "[" && s[i + 1] === "[") {
      depth += 1;
      buf += "[[";
      i += 1;
      continue;
    }
    if (c === "]" && s[i + 1] === "]") {
      depth -= 1;
      buf += "]]";
      i += 1;
      continue;
    }
    if (c === "{" && s[i + 1] === "{") {
      depth += 1;
      buf += "{{";
      i += 1;
      continue;
    }
    if (c === "}" && s[i + 1] === "}") {
      depth -= 1;
      buf += "}}";
      i += 1;
      continue;
    }
    if (depth === 0 && s.startsWith(sep, i)) {
      out.push(buf);
      buf = "";
      i += sep.length - 1;
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out;
}

type RawCell = { text: string; rowspan: number };

/**
 * Walk every `{| ... |}` wikitable on the page and return the rows of the
 * one whose header row contains both "Pet" and "Rarity" columns.
 *
 * Section headers on the Adopt Me wiki vary across egg pages (`Obtainable
 * Pets`, `Obtainable Pet`, `Christmas Egg Pets`, …) so we can't rely on
 * them. The pet-roster wikitable always has consistent column headers.
 *
 * Rowspans are expanded; the returned rows are flat with one cell per
 * column. Column count varies (3 or 4 today), and the rarity index is
 * resolved from the header — important for 4-column tables whose last
 * column is "Chance", not rarity.
 */
export function parseObtainablePetsTable(
  wikitext: string
): Array<{ petCell: string; rarityCell: string }> {
  return parseObtainableEntityTable(wikitext, /\bpet\b/i).map((r) => ({
    petCell: r.entityCell,
    rarityCell: r.rarityCell,
  }));
}

/**
 * Same shape as `parseObtainablePetsTable` but matches "Item" headers used
 * on gift / reward-box pages (e.g. the RGB Reward Box). The category column
 * — when present — is surfaced so we can hint at the contained item's type
 * (pet, toy, accessory, …).
 *
 * Some gift pages still use "Pet" headers (e.g. mixed-content gifts), so
 * we accept either "Item" or "Pet" as the entity column header.
 */
export function parseObtainableItemsTable(
  wikitext: string
): Array<{
  itemCell: string;
  rarityCell: string;
  categoryCell: string | null;
  chanceCell: string | null;
}> {
  return parseObtainableEntityTable(wikitext, /\b(item|pet)\b/i, {
    includeCategory: true,
    includeChance: true,
  }).map((r) => ({
    itemCell: r.entityCell,
    rarityCell: r.rarityCell,
    categoryCell: r.categoryCell,
    chanceCell: r.chanceCell,
  }));
}

function parseObtainableEntityTable(
  wikitext: string,
  entityRegex: RegExp,
  options: { includeCategory?: boolean; includeChance?: boolean } = {}
): Array<{
  entityCell: string;
  rarityCell: string;
  categoryCell: string | null;
  chanceCell: string | null;
}> {
  const tables = extractAllTables(wikitext);
  for (const tableBlock of tables) {
    const { dataRows, headerCells } = splitTableIntoRows(tableBlock);
    const entityIdx = headerCells.findIndex((c) => entityRegex.test(c.text));
    const rarityIdx = headerCells.findIndex((c) => /\brarity\b/i.test(c.text));
    if (entityIdx < 0 || rarityIdx < 0) continue;

    const categoryIdx = options.includeCategory
      ? headerCells.findIndex((c) => /\bcategory\b/i.test(c.text))
      : -1;
    const chanceIdx = options.includeChance
      ? headerCells.findIndex((c) => /\b(chance|odds)\b/i.test(c.text))
      : -1;

    return expandTableRowsExtended(
      dataRows,
      headerCells.length,
      entityIdx,
      rarityIdx,
      categoryIdx,
      chanceIdx
    );
  }
  return [];
}

/**
 * Extract every `{| ... |}` block in the source. Tables can sit at any
 * indentation but each starts on its own line in the Adopt Me wiki's
 * pages.
 */
function extractAllTables(wikitext: string): string[] {
  const tables: string[] = [];
  let i = 0;
  while (i < wikitext.length) {
    const start = wikitext.indexOf("{|", i);
    if (start < 0) break;
    const end = wikitext.indexOf("\n|}", start);
    if (end < 0) {
      tables.push(wikitext.slice(start));
      break;
    }
    tables.push(wikitext.slice(start, end));
    i = end + 3;
  }
  return tables;
}

/**
 * Split a single `{|` block into its header row (if any) and its data rows.
 */
function splitTableIntoRows(tableBlock: string): {
  headerCells: RawCell[];
  dataRows: RawCell[][];
} {
  const chunks = tableBlock.split(/\n\|-+[^\n]*/);
  let headerCells: RawCell[] = [];
  const dataRows: RawCell[][] = [];
  for (const chunk of chunks.slice(1)) {
    if (!chunk.trim()) continue;
    const cells = parseRowCells(chunk);
    if (cells.length === 0) continue;
    const isHeader = cells.every(
      (c) => c.text === "" || c.text.startsWith("!")
    );
    if (isHeader) {
      if (headerCells.length === 0) {
        headerCells = cells.map((c) => ({
          ...c,
          text: c.text.replace(/^!/, "").trim(),
        }));
      }
      continue;
    }
    dataRows.push(cells);
  }
  // Some pages put the header row *before* the first `|-` separator
  // (no separator above the header). Inspect chunks[0] for that case.
  if (headerCells.length === 0 && chunks[0]) {
    // The first chunk is the table opener; strip the `{| ...` first line
    // and try to parse cells from the remainder.
    const newlineIdx = chunks[0].indexOf("\n");
    if (newlineIdx >= 0) {
      const rest = chunks[0].slice(newlineIdx + 1);
      const cells = parseRowCells(rest);
      if (cells.length > 0 && cells.every((c) => c.text.startsWith("!"))) {
        headerCells = cells.map((c) => ({
          ...c,
          text: c.text.replace(/^!/, "").trim(),
        }));
      }
    }
  }
  return { headerCells, dataRows };
}

/**
 * Expand rowspans across the data rows of a parsed table, then pick out the
 * pet- and rarity-column cells for downstream parsing.
 */
function expandTableRowsExtended(
  dataRows: RawCell[][],
  headerLen: number,
  entityIdx: number,
  rarityIdx: number,
  categoryIdx: number,
  chanceIdx: number
): Array<{
  entityCell: string;
  rarityCell: string;
  categoryCell: string | null;
  chanceCell: string | null;
}> {
  let numCols = headerLen;
  for (const row of dataRows) numCols = Math.max(numCols, row.length);
  if (numCols === 0) return [];

  type CarryCell = { text: string; remaining: number } | null;
  const carries: CarryCell[] = new Array(numCols).fill(null);
  const expanded: string[][] = [];

  for (const row of dataRows) {
    const expandedRow: string[] = [];
    let cellIdx = 0;
    for (let col = 0; col < numCols; col++) {
      const carry = carries[col];
      if (carry && carry.remaining > 0) {
        expandedRow.push(carry.text);
        carry.remaining -= 1;
        if (carry.remaining === 0) carries[col] = null;
        continue;
      }
      const cell = row[cellIdx++];
      if (!cell) {
        expandedRow.push("");
        continue;
      }
      expandedRow.push(cell.text);
      if (cell.rowspan > 1) {
        carries[col] = { text: cell.text, remaining: cell.rowspan - 1 };
      }
    }
    expanded.push(expandedRow);
  }

  return expanded.map((row) => ({
    entityCell: row[entityIdx] ?? "",
    rarityCell: row[rarityIdx] ?? "",
    categoryCell: categoryIdx >= 0 ? (row[categoryIdx] ?? null) : null,
    chanceCell: chanceIdx >= 0 ? (row[chanceIdx] ?? null) : null,
  }));
}

/**
 * Parse a single row chunk (the text between `|-` markers) into cells.
 *
 *   |[[Wolpertinger]]
 *   |[[File:AM Wolpertinger.png|center]]
 *   |Common
 *
 * becomes 3 cells. `rowspan="2"` attribute prefixes are honoured.
 */
function parseRowCells(chunk: string): RawCell[] {
  const lines = chunk.split("\n");
  const cells: RawCell[] = [];
  let current: { text: string; rowspan: number } | null = null;

  function flush() {
    if (current != null) {
      cells.push({ text: current.text.trim(), rowspan: current.rowspan });
      current = null;
    }
  }

  for (const lineRaw of lines) {
    const line = lineRaw.replace(/\s+$/, "");
    if (line.startsWith("|") || line.startsWith("!")) {
      flush();
      const isHeader = line.startsWith("!");
      let rest = line.slice(1);
      // Inline cell separator `||` (or `!!` for headers) splits multiple
      // cells on one line. The Adopt Me wiki almost never uses this; we
      // still support it for robustness.
      const inlineSep = isHeader ? "!!" : "||";
      const inlineParts = splitTopLevel(rest, inlineSep);

      for (let p = 0; p < inlineParts.length; p++) {
        if (p > 0) {
          flush();
        }
        let part = inlineParts[p];
        const sepIdx = findAttrSeparator(part);
        let attrs = "";
        if (sepIdx >= 0) {
          attrs = part.slice(0, sepIdx);
          part = part.slice(sepIdx + 1);
        }
        const rowspan = parseRowspan(attrs);
        current = {
          text: (isHeader ? "!" : "") + part,
          rowspan,
        };
      }
      rest = "";
    } else if (current != null) {
      // Continuation of the previous cell's content.
      current.text += "\n" + line;
    }
  }
  flush();
  return cells;
}

function parseRowspan(attrs: string): number {
  const m = attrs.match(/rowspan\s*=\s*"?(\d+)"?/i);
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Find the index of the `|` that separates a cell's attribute block from its
 * content (e.g. `rowspan="2" |Rare`). Ignores pipes inside `[[...]]`/`{{...}}`.
 * Returns -1 if no separator is present.
 */
function findAttrSeparator(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ((c === "[" || c === "{") && s[i + 1] === c) {
      depth += 1;
      i += 1;
      continue;
    }
    if ((c === "]" || c === "}") && s[i + 1] === c) {
      depth -= 1;
      i += 1;
      continue;
    }
    if (c === "|" && depth === 0) return i;
  }
  return -1;
}

/**
 * Extract the pet name and link target from a cell containing a wiki link.
 *
 *   "[[Wolpertinger]]"             → { target: "Wolpertinger", display: "Wolpertinger" }
 *   "[[Phoenix (Pet)|Phoenix]]"    → { target: "Phoenix (Pet)", display: "Phoenix" }
 *
 * Returns `null` if no link is found.
 */
export function parsePetLink(
  cellText: string
): { target: string; display: string } | null {
  const m = cellText.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (!m) return null;
  const target = m[1].trim();
  const display = (m[2] ?? m[1]).trim();
  return { target, display };
}

export type ParsedEggPage = {
  odds: Array<{ rarity: HatchRarity; probabilityPct: number | null }>;
  pets: Array<{ petTitle: string; petDisplay: string; rarity: HatchRarity }>;
  /** Filename from the `{{Eggs|image=...}}` field, with no `File:` prefix. */
  imageFilename: string | null;
};

const INFOBOX_RARITY_FIELDS: Array<[string, HatchRarity]> = [
  ["common", "common"],
  ["uncommon", "uncommon"],
  ["rare", "rare"],
  ["ultra-rare", "ultra_rare"],
  ["ultra_rare", "ultra_rare"],
  ["ultra rare", "ultra_rare"],
  ["legendary", "legendary"],
];

export function parseEggWikitext(wikitext: string): ParsedEggPage {
  const odds: ParsedEggPage["odds"] = [];
  const infobox = parseEggsInfobox(wikitext);
  let imageFilename: string | null = null;
  if (infobox) {
    const seen = new Set<HatchRarity>();
    for (const [key, rarity] of INFOBOX_RARITY_FIELDS) {
      if (seen.has(rarity)) continue;
      const raw = infobox.get(key);
      if (raw == null) continue;
      const probabilityPct = parsePct(raw);
      odds.push({ rarity, probabilityPct });
      seen.add(rarity);
    }
    imageFilename = normaliseFilename(infobox.get("image"));
  }

  const pets: ParsedEggPage["pets"] = [];
  for (const { petCell, rarityCell } of parseObtainablePetsTable(wikitext)) {
    const link = parsePetLink(petCell);
    if (!link) continue;
    const rarity = normaliseRarity(rarityCell);
    if (!rarity) continue;
    pets.push({ petTitle: link.target, petDisplay: link.display, rarity });
  }

  return { odds, pets, imageFilename };
}

/**
 * Clean a wikitext file value into a bare filename.
 *
 *   "[[File:Mythic Egg.png|150px]]" → "Mythic Egg.png"
 *   "File:Mythic Egg.png"           → "Mythic Egg.png"
 *   "Mythic Egg.png"                → "Mythic Egg.png"
 *   undefined / empty               → null
 */
export function normaliseFilename(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  let s = value.trim();
  // Strip surrounding [[File:...]] or [[Image:...]]
  const link = s.match(/^\[\[(?:File|Image):([^\]|]+)/i);
  if (link) s = link[1].trim();
  // Strip leading "File:" / "Image:" if present.
  s = s.replace(/^(?:File|Image):/i, "").trim();
  // If we still have pipe params (size etc.), keep only the filename.
  const pipe = s.indexOf("|");
  if (pipe >= 0) s = s.slice(0, pipe).trim();
  // Surrounding wikitext sometimes leaves a trailing "]]" we missed above.
  s = s.replace(/\]\]\s*$/, "").trim();
  return s.length > 0 ? s : null;
}

/* ───────────────────── HTTP fetchers ───────────────────── */

type CategoryMembersResponse = {
  query?: {
    categorymembers?: Array<{ pageid: number; title: string }>;
  };
};

type ParseResponse = {
  parse?: {
    title: string;
    pageid: number;
    revid?: number;
    wikitext?: string | { "*"?: string };
  };
  error?: { code: string; info: string };
};

export async function fetchEggTitles(): Promise<string[]> {
  const url =
    `${API_URL}?action=query&list=categorymembers&cmtitle=Category%3AEggs` +
    `&cmlimit=500&cmtype=page&format=json&formatversion=2`;
  const data = await fetchJson<CategoryMembersResponse>(url);
  const members = data.query?.categorymembers ?? [];
  return members
    .map((m) => m.title)
    // Drop anything that doesn't look like an egg page. The category has
    // accumulated some misfiled pages over time (e.g. "Wrapped Doll").
    .filter((title) => /\begg\b/i.test(title));
}

export async function fetchEggWikitext(
  title: string
): Promise<{ wikitext: string; revid: string | null }> {
  const url =
    `${API_URL}?action=parse&page=${encodeURIComponent(title)}` +
    `&prop=wikitext%7Crevid&format=json&formatversion=2`;
  const data = await fetchJson<ParseResponse>(url);
  if (data.error) throw new Error(`fandom parse: ${data.error.info}`);
  const raw = data.parse?.wikitext;
  const wikitext =
    typeof raw === "string" ? raw : (raw?.["*"] ?? "");
  const revid = data.parse?.revid != null ? String(data.parse.revid) : null;
  return { wikitext, revid };
}

type ImageInfoResponse = {
  query?: {
    pages?: Array<{
      title: string;
      missing?: boolean;
      imageinfo?: Array<{ url?: string }>;
    }>;
  };
};

/**
 * Resolve a list of wiki file names (e.g. `"Mythic Egg.png"`) into their
 * canonical CDN URLs. The MediaWiki imageinfo API accepts up to 50 titles
 * per call; we chunk and merge.
 *
 * Missing files are simply omitted from the returned map.
 */
export async function fetchFandomFileUrls(
  filenames: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(filenames.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const titles = chunk.map((f) => `File:${f}`).join("|");
    const url =
      `${API_URL}?action=query&titles=${encodeURIComponent(titles)}` +
      `&prop=imageinfo&iiprop=url&format=json&formatversion=2`;
    const data = await fetchJson<ImageInfoResponse>(url);
    const pages = data.query?.pages ?? [];
    for (const page of pages) {
      if (page.missing) continue;
      const imageUrl = page.imageinfo?.[0]?.url;
      if (!imageUrl) continue;
      const cleanTitle = page.title.replace(/^File:/i, "");
      out.set(cleanTitle, imageUrl);
    }
  }
  return out;
}

export type EggImageDiscovery = {
  /** Egg slug → resolved source image URL (Fandom CDN). */
  bySlug: Map<string, string>;
  fetchedAt: string;
};

export type FetchEggImagesOptions = {
  maxPages?: number;
  delayMs?: number;
  /** Restrict to a subset of egg slugs (skip pages we don't care about). */
  onlyEggSlugs?: Set<string>;
};

/**
 * Walk every egg page, harvest the `{{Eggs|image=...}}` filename, and
 * resolve filenames to CDN URLs. Pages without an `image` field are skipped.
 *
 * Returned URLs point at the wiki's CDN; callers should fetch them and cache
 * locally rather than hotlink (so we don't depend on the wiki's uptime, and
 * so removed pages keep working).
 */
export async function fetchFandomEggImages(
  options: FetchEggImagesOptions = {}
): Promise<EggImageDiscovery> {
  const titles = await fetchEggTitles();
  const slice = options.maxPages ? titles.slice(0, options.maxPages) : titles;
  const filenameByTitle = new Map<string, string>();
  const slugByTitle = new Map<string, string>();
  for (const title of slice) {
    const slug = pageTitleToSlug(title);
    if (options.onlyEggSlugs && !options.onlyEggSlugs.has(slug)) continue;
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    try {
      const { wikitext } = await fetchEggWikitext(title);
      const parsed = parseEggWikitext(wikitext);
      if (parsed.imageFilename) {
        filenameByTitle.set(title, parsed.imageFilename);
        slugByTitle.set(title, slug);
      }
    } catch (err) {
      console.warn(`[fandomWiki] image parse failed for "${title}":`, err);
    }
  }

  const urlByFilename = await fetchFandomFileUrls(
    Array.from(filenameByTitle.values())
  );
  const bySlug = new Map<string, string>();
  for (const [title, filename] of filenameByTitle) {
    const slug = slugByTitle.get(title);
    if (!slug) continue;
    const url = urlByFilename.get(filename);
    if (url) bySlug.set(slug, url);
  }
  return { bySlug, fetchedAt: new Date().toISOString() };
}

export type FetchFandomEggsOptions = {
  /** Cap on the number of egg pages to fetch (mostly for tests). */
  maxPages?: number;
  /** Optional delay between sequential page fetches in milliseconds. */
  delayMs?: number;
  /** Override the page-title list (handy for tests / single-egg debugging). */
  titles?: string[];
};

/**
 * Walk the wiki, parse every egg page, and return flat row arrays ready for
 * upsert into Supabase.
 */
export async function fetchFandomEggs(
  options: FetchFandomEggsOptions = {}
): Promise<FandomHatchPayload> {
  const titles = options.titles ?? (await fetchEggTitles());
  const slice = options.maxPages ? titles.slice(0, options.maxPages) : titles;
  const odds: EggHatchOddsRow[] = [];
  const pets: EggHatchPetRow[] = [];

  for (const title of slice) {
    if (options.delayMs) {
      await new Promise((r) => setTimeout(r, options.delayMs));
    }
    try {
      const { wikitext, revid } = await fetchEggWikitext(title);
      const parsed = parseEggWikitext(wikitext);
      const eggSlug = pageTitleToSlug(title);
      for (const o of parsed.odds) {
        odds.push({
          eggTitle: title,
          eggSlug,
          rarity: o.rarity,
          probabilityPct: o.probabilityPct,
          source: FANDOM_SOURCE,
          sourceRevisionId: revid,
        });
      }
      for (const p of parsed.pets) {
        pets.push({
          eggTitle: title,
          eggSlug,
          petTitle: p.petTitle,
          petDisplayName: p.petDisplay,
          petSlug: pageTitleToSlug(p.petTitle),
          rarity: p.rarity,
          source: FANDOM_SOURCE,
          sourceRevisionId: revid,
        });
      }
    } catch (err) {
      console.warn(`[fandomWiki] egg parse failed for "${title}":`, err);
    }
  }

  return {
    odds,
    pets,
    fetchedAt: new Date().toISOString(),
    eggCount: slice.length,
  };
}

/* ──────────────────────── Box / gift contents ──────────────────────── */

export type GiftItemRow = {
  giftTitle: string;
  giftSlug: string;
  itemTitle: string;
  itemDisplayName: string;
  itemSlug: string;
  rarity: HatchRarity | null;
  categoryHint: string | null;
  chancePct: number | null;
  source: string;
  sourceRevisionId: string | null;
};

export type FandomGiftsPayload = {
  oddsByGift: EggHatchOddsRow[];
  items: GiftItemRow[];
  fetchedAt: string;
  giftCount: number;
};

/**
 * Members of `Category:Gifts` on the wiki — RGB Reward Box, Festive Reward
 * Box, gamepass gifts, etc. The category also contains a few miscellaneous
 * pages we don't want (sub-categories, navigation pages); we filter by a
 * keyword check on the title.
 */
export async function fetchGiftTitles(): Promise<string[]> {
  const url =
    `${API_URL}?action=query&list=categorymembers&cmtitle=Category%3AGifts` +
    `&cmlimit=500&cmtype=page&format=json&formatversion=2`;
  const data = await fetchJson<CategoryMembersResponse>(url);
  const members = data.query?.categorymembers ?? [];
  // Heuristic: keep pages that look like "Foo Box" / "Foo Gift" / "Foo
  // Reward" / "Foo Bundle". Filters out broad index pages like "Gifts".
  return members
    .map((m) => m.title)
    .filter((title) =>
      /\b(box|gift|reward|bundle|crate|pack|present|stocking)\b/i.test(title)
    );
}

/**
 * Strip the leading `[[Foo]]` link from a chance/rarity/category cell to get
 * a plain label. Falls back to the cell text if no link is present.
 */
function stripLinks(cellText: string): string {
  return cellText
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*:?\s*Category:\s*/i, "")
    .trim();
}

export async function fetchFandomGifts(
  options: FetchFandomEggsOptions = {}
): Promise<FandomGiftsPayload> {
  const titles = options.titles ?? (await fetchGiftTitles());
  const slice = options.maxPages ? titles.slice(0, options.maxPages) : titles;
  const odds: EggHatchOddsRow[] = [];
  const items: GiftItemRow[] = [];

  for (const title of slice) {
    if (options.delayMs) {
      await new Promise((r) => setTimeout(r, options.delayMs));
    }
    try {
      const { wikitext, revid } = await fetchEggWikitext(title);
      const giftSlug = pageTitleToSlug(title);

      // Reuse the Eggs-infobox parser for per-rarity odds where present.
      const infobox = parseEggsInfobox(wikitext);
      if (infobox) {
        const seen = new Set<HatchRarity>();
        for (const [key, rarity] of INFOBOX_RARITY_FIELDS) {
          if (seen.has(rarity)) continue;
          const raw = infobox.get(key);
          if (raw == null) continue;
          odds.push({
            eggTitle: title,
            eggSlug: giftSlug,
            rarity,
            probabilityPct: parsePct(raw),
            source: FANDOM_SOURCE,
            sourceRevisionId: revid,
          });
          seen.add(rarity);
        }
      }

      for (const row of parseObtainableItemsTable(wikitext)) {
        const link = parsePetLink(row.itemCell);
        if (!link) continue;
        const rarity = normaliseRarity(row.rarityCell);
        const categoryHint = row.categoryCell
          ? stripLinks(row.categoryCell).toLowerCase() || null
          : null;
        const chancePct = parsePct(row.chanceCell);
        items.push({
          giftTitle: title,
          giftSlug,
          itemTitle: link.target,
          itemDisplayName: link.display,
          itemSlug: pageTitleToSlug(link.target),
          rarity,
          categoryHint,
          chancePct,
          source: FANDOM_SOURCE,
          sourceRevisionId: revid,
        });
      }
    } catch (err) {
      console.warn(`[fandomWiki] gift parse failed for "${title}":`, err);
    }
  }

  return {
    oddsByGift: odds,
    items,
    fetchedAt: new Date().toISOString(),
    giftCount: slice.length,
  };
}

/* ──────────────────────── Pet acquisition (prose) ──────────────────────── */

/** What we extract from the lede paragraphs of a pet's wiki page. */
export type ParsedPetAcquisition = {
  kind: "event" | "robux" | "paid" | "task" | "gift" | "other";
  eventName: string | null;
  eventYear: number | null;
  currency: string | null;
  cost: number | null;
  retired: boolean;
  releasedAt: string | null; // ISO YYYY-MM-DD
  notes: string | null;
};

/**
 * Strip leading housekeeping templates from a wiki page so prose
 * extraction sees the actual lede. Removes:
 *
 *   • `{{Ambiguous|...}}` / `{{Disambiguation|...}}` / `{{Redirect|...}}`
 *   • The `{{Pets|...}}` infobox (with its nested `{{Robux|...}}` etc.)
 *
 * Returns the wikitext with those blocks removed.
 */
function stripPetsInfobox(wikitext: string): string {
  let text = wikitext;
  // Strip housekeeping templates anywhere in the lede (they can sit on
  // their own line above OR below the {{Pets}} infobox).
  const housekeeping = /\{\{(Ambiguous|Disambiguation|Redirect)[\s|}]/i;
  for (let pass = 0; pass < 4; pass++) {
    const m = text.match(housekeeping);
    if (!m || m.index === undefined) break;
    text = removeBalancedTemplate(text, m.index) ?? text;
  }
  // Strip the {{Pets}} infobox itself.
  const petsMatch = text.match(/\{\{Pets[\s|}]/i);
  if (petsMatch && petsMatch.index !== undefined) {
    text = removeBalancedTemplate(text, petsMatch.index) ?? text;
  }
  return text;
}

/**
 * Helper for stripping a brace-balanced `{{...}}` template starting at
 * `start`. Returns the wikitext with the template removed, or null if
 * the braces are malformed.
 */
function removeBalancedTemplate(
  wikitext: string,
  start: number
): string | null {
  let depth = 0;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === "{" && wikitext[i + 1] === "{") {
      depth += 1;
      i += 1;
    } else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
      depth -= 1;
      if (depth === 0) {
        return wikitext.slice(0, start) + wikitext.slice(i + 2);
      }
      i += 1;
    }
  }
  return null;
}

const CURRENCY_TEMPLATES = new Set([
  "robux",
  "candy",
  "candies",
  "gingerbread",
  "bucks",
  "tickets",
  "stars",
  "starlight",
]);

const CURRENCY_NORMALISE: Record<string, string> = {
  candies: "candy",
};

/**
 * Pull the FIRST currency template out of prose. Supports the variants the
 * Adopt Me wiki uses, e.g. `{{Robux|500}}` / `{{Candy|180,000}}`.
 */
function extractCurrency(text: string): { currency: string; cost: number | null } | null {
  const re = /\{\{([A-Za-z]+)\s*\|\s*([^}|]+?)\s*(?:\||\}\})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tmpl = m[1].toLowerCase();
    if (!CURRENCY_TEMPLATES.has(tmpl)) continue;
    const currency = CURRENCY_NORMALISE[tmpl] ?? tmpl;
    const amount = parseInt(m[2].replace(/[,\s]/g, ""), 10);
    return {
      currency,
      cost: Number.isFinite(amount) ? amount : null,
    };
  }
  return null;
}

/**
 * Pull the first event link out of prose. Event pages on the wiki follow
 * the convention `[[Name Event (Year)]]` or `[[Name Event]]`.
 */
function extractEvent(text: string): {
  eventName: string;
  eventYear: number | null;
} | null {
  // Match `[[X Event (YYYY)]]` or `[[X Event]]` or `[[X Update (YYYY)]]`.
  const re = /\[\[([A-Z][A-Za-z0-9' ]+?\s+(?:Event|Update))(?:\s*\((\d{4})\))?(?:\|[^\]]+)?\]\]/;
  const m = text.match(re);
  if (!m) return null;
  return {
    eventName: m[1].trim(),
    eventYear: m[2] ? parseInt(m[2], 10) : null,
  };
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Parse a wiki prose date like `October 28, 2020` → `2020-10-28`. Returns
 * null if the date can't be parsed reliably.
 */
function parseProseDate(text: string): string | null {
  const m = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i
  );
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(year)) return null;
  const d = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const RETIRED_PHRASES = [
  /\blimited\b/i,
  /\bleft the game\b/i,
  /\bno longer obtainable\b/i,
  /\bunavailable\b/i,
  /\bevent has ended\b/i,
  /\bnow only (?:obtainable|available) through (?:\[\[)?[Tt]rade/i,
  /\bcan(?: now)? only be obtained (?:through |by )?(?:\[\[)?[Tt]rad/i,
];

/**
 * Heuristic prose extraction of "how does this pet enter the game?".
 * Returns `null` when no usable signal is found.
 *
 * Strategy:
 *   - Strip the `{{Pets}}` infobox so currency templates inside it don't
 *     pollute the prose match.
 *   - Look at the first ~3 paragraphs (the lede typically contains the
 *     acquisition statement).
 *   - Skip pages whose only acquisition is egg hatching — those are
 *     already covered by the egg-hatch flow.
 */
export function parsePetAcquisitionFromWikitext(
  wikitext: string
): ParsedPetAcquisition | null {
  const body = stripPetsInfobox(wikitext);
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  const lede = paragraphs.slice(0, 3).join("\n\n");

  const event = extractEvent(lede);
  const currency = extractCurrency(lede);
  const releasedAt = parseProseDate(lede);
  const retired = RETIRED_PHRASES.some((re) => re.test(lede));

  // If the lede ONLY mentions egg-hatching (no event, no purchase, no
  // explicit "limited" language), don't emit an acquisition row — the
  // egg-hatch pipeline already covers it.
  const hatchOnly =
    !event &&
    !currency &&
    !retired &&
    /\b(hatched? from|can be obtained by hatching)\b/i.test(lede);
  if (hatchOnly) return null;

  if (!event && !currency && !retired && !releasedAt) return null;

  let kind: ParsedPetAcquisition["kind"];
  if (currency?.currency === "robux") {
    kind = "robux";
  } else if (currency) {
    kind = "paid";
  } else if (event) {
    kind = "event";
  } else if (retired) {
    kind = "other";
  } else {
    kind = "other";
  }

  return {
    kind,
    eventName: event?.eventName ?? null,
    eventYear: event?.eventYear ?? null,
    currency: currency?.currency ?? null,
    cost: currency?.cost ?? null,
    retired,
    releasedAt,
    notes: null,
  };
}

export type PetAcquisitionRow = ParsedPetAcquisition & {
  petTitle: string;
  petSlug: string;
  source: string;
  sourceRevisionId: string | null;
};

export type FandomPetAcquisitionsPayload = {
  acquisitions: PetAcquisitionRow[];
  fetchedAt: string;
  pageCount: number;
  /** Pet titles we fetched but where no acquisition could be extracted. */
  skipped: string[];
};

export type FetchPetAcquisitionsOptions = {
  delayMs?: number;
  maxPages?: number;
  /** Wiki page titles to fetch — one per pet. */
  titles: string[];
};

/**
 * Walk a list of pet wiki page titles, parse the lede paragraphs, and
 * return one acquisition row per pet that we could extract usable signal
 * for. Pets with no usable signal (e.g. clean egg-hatch-only pets) are
 * counted in `skipped` and excluded from `acquisitions`.
 */
export async function fetchPetAcquisitions(
  options: FetchPetAcquisitionsOptions
): Promise<FandomPetAcquisitionsPayload> {
  const titles = options.maxPages
    ? options.titles.slice(0, options.maxPages)
    : options.titles;
  const acquisitions: PetAcquisitionRow[] = [];
  const skipped: string[] = [];

  for (const title of titles) {
    if (options.delayMs) {
      await new Promise((r) => setTimeout(r, options.delayMs));
    }
    try {
      const { wikitext, revid } = await fetchEggWikitext(title);
      const parsed = parsePetAcquisitionFromWikitext(wikitext);
      if (!parsed) {
        skipped.push(title);
        continue;
      }
      acquisitions.push({
        ...parsed,
        petTitle: title,
        petSlug: pageTitleToSlug(title),
        source: FANDOM_SOURCE,
        sourceRevisionId: revid,
      });
    } catch (err) {
      console.warn(`[fandomWiki] acquisition parse failed for "${title}":`, err);
      skipped.push(title);
    }
  }

  return {
    acquisitions,
    fetchedAt: new Date().toISOString(),
    pageCount: titles.length,
    skipped,
  };
}
