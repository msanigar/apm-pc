import type {
  ImportRunSummary,
  ItemDetailResponse,
  SearchIndexResponse,
} from "@shared/types";

const JSON_HEADERS = { accept: "application/json" };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...JSON_HEADERS, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchSearchIndex(): Promise<SearchIndexResponse> {
  return fetchJson<SearchIndexResponse>("/api/search-index");
}

export function fetchItem(slug: string): Promise<ItemDetailResponse> {
  return fetchJson<ItemDetailResponse>(
    `/api/items/${encodeURIComponent(slug)}`
  );
}

export function fetchLatestImportRun(): Promise<{
  run: ImportRunSummary | null;
  supabaseConfigured: boolean;
}> {
  return fetchJson("/api/import-runs/latest");
}
