import { useEffect, useMemo, useState } from "react";
import Fuse, { type IFuseOptions } from "fuse.js";
import type { SearchIndexItem } from "@shared/types";
import { fetchSearchIndex } from "./api";

// Bump this whenever the shape of the cached payload or the Fuse config
// changes. Old caches (v1) loaded when production only had ~10 mock items;
// users with that cache see a near-empty search index for the first paint.
// Bumping the key forces a re-fetch on next page load.
const STORAGE_KEY = "amvc:search-index:v3";
// Short cache TTL while we're iterating fast. Cheap to re-fetch (the
// /api/search-index function is on Netlify CDN with stale-while-revalidate),
// and 1h means users see updates within an hour of redeploys.
const STALE_AFTER_MS = 60 * 60 * 1000;

const FUSE_OPTIONS: IFuseOptions<SearchIndexItem> = {
  keys: [
    { name: "name", weight: 0.7 },
    { name: "aliases", weight: 0.2 },
    { name: "slug", weight: 0.1 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
  includeScore: true,
  minMatchCharLength: 2,
  // Cap the per-query candidate set. Helps short fuzzy queries against a
  // 3k+ item index return results in a few ms.
  shouldSort: true,
};

type Cached = {
  generatedAt: string;
  storedAt: number;
  items: SearchIndexItem[];
};

function readCache(): Cached | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed.items || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cached: Cached): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // localStorage can fail in private mode; ignore.
  }
}

export type SearchIndexState = {
  items: SearchIndexItem[];
  fuse: Fuse<SearchIndexItem> | null;
  isLoading: boolean;
  error: string | null;
  generatedAt: string | null;
};

/**
 * Loads the search index once per session, persists it to localStorage for
 * one day, and exposes a pre-built Fuse instance for downstream components.
 */
export function useSearchIndex(): SearchIndexState {
  const [items, setItems] = useState<SearchIndexItem[]>(() => readCache()?.items ?? []);
  const [generatedAt, setGeneratedAt] = useState<string | null>(
    () => readCache()?.generatedAt ?? null
  );
  const [isLoading, setIsLoading] = useState<boolean>(items.length === 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const cached = readCache();
    const cachedIsFresh = cached && Date.now() - cached.storedAt < STALE_AFTER_MS;
    // Treat a tiny cache (probably an old mock-data snapshot) as not fresh
    // even if it's recent — force a loading state until real data arrives
    // rather than rendering search results against a 10-item index.
    const cachedIsTrustworthy = cachedIsFresh && (cached?.items.length ?? 0) >= 100;
    if (!cachedIsTrustworthy) setIsLoading(true);

    fetchSearchIndex()
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setGeneratedAt(res.generatedAt);
        writeCache({
          generatedAt: res.generatedAt,
          storedAt: Date.now(),
          items: res.items,
        });
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const fuse = useMemo(() => {
    if (items.length === 0) return null;
    return new Fuse(items, FUSE_OPTIONS);
  }, [items]);

  return { items, fuse, isLoading, error, generatedAt };
}
