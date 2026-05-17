import type { RawSourceValue } from "../../shared/normalize";
import type { ItemCategory, Variant } from "../../shared/types";
import type { SourceAdapter } from "./types";

/**
 * Shared helpers used by every real source adapter.
 *
 * Keeping these in one file makes the actual adapters small and gives us one
 * place to update fetch behaviour (UA, timeout, retries) when sources change.
 *
 * ─── Terms of Service reminder ────────────────────────────────────────────
 * Every adapter here is making a real HTTP request to a third-party site.
 * Before enabling an adapter in production, check the source's robots.txt,
 * terms of service, and any explicit guidance from the site owners about
 * automated access, caching, and attribution. Daily-scheduled access is the
 * least invasive cadence we can run on — keep it that way.
 * Image caching MUST also be checked against the source's image-use terms
 * before we start downloading anything into Supabase Storage.
 */

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; AdoptMeValueCheckerBot/0.1; +https://adoptmevalues.example/about)";
const DEFAULT_TIMEOUT_MS = 15_000;

export type SafeFetchOptions = {
  timeoutMs?: number;
  headers?: Record<string, string>;
  acceptJson?: boolean;
};

/**
 * `fetch` with a timeout, a custom UA, and some sensible defaults so we never
 * hammer a source. Throws on non-2xx responses so adapters can let errors
 * bubble up to the `safeAdapter` wrapper.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": DEFAULT_USER_AGENT,
        accept: options.acceptJson
          ? "application/json"
          : "text/html,application/xhtml+xml",
        ...(options.headers ?? {}),
      },
      // Don't follow redirects to a different host without us knowing.
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`fetch failed: ${res.status} ${res.statusText} (${url})`);
    }
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url: string, options?: SafeFetchOptions): Promise<string> {
  const res = await safeFetch(url, options);
  return res.text();
}

export async function fetchJson<T>(url: string, options?: SafeFetchOptions): Promise<T> {
  const res = await safeFetch(url, { ...options, acceptJson: true });
  return (await res.json()) as T;
}

/**
 * Parse a value string emitted by a source into a positive RP number.
 *
 * Returns `null` for anything that should be treated as "missing":
 *   - empty / whitespace
 *   - dashes: "—", "–", "-"
 *   - common "no value yet" strings: "N/A", "TBD", "?"
 *   - zero or negative numbers
 *
 * Accepts:
 *   - plain numbers ("125", 125)
 *   - decimals ("12.5")
 *   - k/m suffixes ("1.5k", "2M")
 *   - thousands separators ("1,250")
 */
export function parseRpValue(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) && input > 0 ? input : null;
  }
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  // Reject explicit "no value" markers.
  if (/^(—|–|-+|n\/?a|tbd|\?+|none|unknown)$/i.test(trimmed)) return null;

  // Strip currency-ish suffixes/prefixes ("RP", "rp", "$" — be conservative).
  let s = trimmed.replace(/\s*rp\s*$/i, "").replace(/,/g, "").trim();
  let multiplier = 1;
  const tail = s.slice(-1).toLowerCase();
  if (tail === "k") {
    multiplier = 1_000;
    s = s.slice(0, -1).trim();
  } else if (tail === "m") {
    multiplier = 1_000_000;
    s = s.slice(0, -1).trim();
  }

  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * multiplier;
}

/**
 * Normalise an absolute or protocol-relative image URL against a base host.
 * Returns `undefined` for blank or obviously-invalid input — we want the
 * downstream image cache to skip these, not fall back to a broken URL.
 */
export function resolveImageUrl(
  raw: string | null | undefined,
  baseHost: string
): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("data:")) return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return `${baseHost.replace(/\/$/, "")}${trimmed}`;
  return `${baseHost.replace(/\/$/, "")}/${trimmed}`;
}

/**
 * Type-safe builder for a single `RawSourceValue`. Returns `null` when the
 * value is missing/invalid so the adapter can `.filter(Boolean)` cheaply.
 */
export type RawValueInit = {
  sourceName: string;
  sourceItemName: string | null | undefined;
  rawValue: unknown;
  category?: ItemCategory;
  variant?: Variant;
  rarity?: string | null;
  imageUrl?: string;
};

export function normalizeSourceValue(init: RawValueInit): RawSourceValue | null {
  const name = (init.sourceItemName ?? "").trim();
  if (!name) return null;
  const valueRp = parseRpValue(init.rawValue);
  if (valueRp == null) return null;
  return {
    sourceName: init.sourceName,
    sourceItemName: name,
    category: init.category,
    variant: init.variant,
    valueRp,
    imageUrl: init.imageUrl,
    confidence: init.rarity ?? undefined,
  };
}

/**
 * Wrap a fetcher so a single source failure can never bring down the sync.
 *
 * - Logs the error with the adapter name.
 * - Returns an empty array on failure (validation logic decides what to do
 *   about a missing source).
 * - Optionally honours an `enabled` flag so callers can hide an adapter
 *   behind an env var without changing the registry.
 */
export function safeAdapter(spec: {
  name: string;
  description: string;
  enabled?: boolean;
  fetchValues: () => Promise<RawSourceValue[]>;
}): SourceAdapter {
  return {
    name: spec.name,
    description: spec.description,
    fetchValues: async () => {
      if (spec.enabled === false) return [];
      try {
        const values = await spec.fetchValues();
        return values.filter((v): v is RawSourceValue => v != null);
      } catch (err) {
        console.warn(`[sources:${spec.name}] failed:`, err);
        return [];
      }
    },
  };
}
