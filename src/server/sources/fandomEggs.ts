/**
 * Fandom (Adopt Me Wiki) egg-hatch adapter.
 *
 *   GET https://adoptme.fandom.com/api.php?action=query&list=categorymembers&cmtitle=Category:Eggs
 *   GET https://adoptme.fandom.com/api.php?action=parse&page={Title}&prop=wikitext|revid
 *
 * The community wiki keeps two pieces of data we want for every egg:
 *
 *   1. A shared `{{Eggs|common=X%|uncommon=Y%|...}}` template that gives the
 *      per-tier hatch percentages.
 *
 *   2. An `== Obtainable Pets ==` wikitable with one row per pet (or one row
 *      per pet with rowspans collapsing pets that share a rarity tier).
 *
 * This adapter walks `Category:Eggs`, fetches each page's wikitext, and emits
 * two flat row arrays the sync pipeline can upsert directly into Supabase.
 *
 * IMPORTANT — Terms of Service:
 *   `https://adoptme.fandom.com/robots.txt` explicitly allows `/api.php?`
 *   paths for generic crawlers. We still treat the API politely:
 *     • daily cadence (cron-driven, never per-request),
 *     • small concurrency (sequential by default),
 *     • a friendly UA via `safeFetch` (see `lib.ts`).
 *
 * IMPORTANT — Wikitext fragility:
 *   The shared template + table format is well-established but not enforced.
 *   The parser is forgiving (missing template → no odds, missing table → no
 *   pets) so a malformed page only loses that egg's data, not the run.
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
  const tables = extractAllTables(wikitext);
  for (const tableBlock of tables) {
    const { dataRows, headerCells } = splitTableIntoRows(tableBlock);
    const petIdx = headerCells.findIndex((c) => /\bpet\b/i.test(c.text));
    const rarityIdx = headerCells.findIndex((c) => /\brarity\b/i.test(c.text));
    if (petIdx < 0 || rarityIdx < 0) continue;
    return expandTableRows(dataRows, headerCells.length, petIdx, rarityIdx);
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
function expandTableRows(
  dataRows: RawCell[][],
  headerLen: number,
  petIdx: number,
  rarityIdx: number
): Array<{ petCell: string; rarityCell: string }> {
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
    petCell: row[petIdx] ?? "",
    rarityCell: row[rarityIdx] ?? "",
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
      console.warn(`[fandomEggs] image parse failed for "${title}":`, err);
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
      console.warn(`[fandomEggs] failed for "${title}":`, err);
    }
  }

  return {
    odds,
    pets,
    fetchedAt: new Date().toISOString(),
    eggCount: slice.length,
  };
}
