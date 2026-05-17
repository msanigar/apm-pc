import { useMemo } from "react";
import type Fuse from "fuse.js";
import type { SearchIndexItem, Variant } from "@shared/types";
import { parseSearchQuery } from "@shared/parseSearchQuery";
import { ResultCard } from "./ResultCard";

type Props = {
  fuse: Fuse<SearchIndexItem> | null;
  items: SearchIndexItem[];
  query: string;
  maxResults?: number;
};

export function SearchResults({ fuse, items, query, maxResults = 25 }: Props) {
  const parsed = useMemo(() => parseSearchQuery(query), [query]);

  const results = useMemo(() => {
    if (!parsed.normalizedQuery) return [];
    if (!fuse) return [];
    const hits = fuse.search(parsed.normalizedQuery, { limit: maxResults });
    // If the user typed a specific variant, prefer items that actually have a
    // value for it.
    const variant = parsed.requestedVariant;
    if (!variant) return hits.map((h) => h.item);
    return hits
      .slice()
      .sort((a, b) => {
        const av = a.item.values[variant] ? 0 : 1;
        const bv = b.item.values[variant] ? 0 : 1;
        if (av !== bv) return av - bv;
        return (a.score ?? 0) - (b.score ?? 0);
      })
      .map((h) => h.item);
  }, [fuse, parsed.normalizedQuery, parsed.requestedVariant, maxResults]);

  if (!parsed.normalizedQuery) {
    return <ExamplesPanel items={items} />;
  }

  if (results.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
        No results for{" "}
        <span className="font-medium text-slate-200">“{query}”</span>.
        <br />
        Try fewer letters or a different name.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {results.map((item) => (
        <li key={item.id}>
          <ResultCard
            item={item}
            highlightVariant={parsed.requestedVariant as Variant | undefined}
          />
        </li>
      ))}
    </ol>
  );
}

const EXAMPLE_QUERIES = [
  "FR Shadow",
  "NFR Frost",
  "MFR Owl",
  "Mega Ride Turtle",
  "Neon Cow",
  "Ride Potion",
];

function ExamplesPanel({ items }: { items: SearchIndexItem[] }) {
  const popular = items
    .filter((i) => i.values.fly_ride || i.values.neon_fly_ride)
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Try one of these
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLE_QUERIES.map((q) => (
            <button
              key={q}
              type="button"
              className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1 text-sm text-slate-200 transition hover:border-brand-500/50 hover:bg-slate-900"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("amvc:example-query", { detail: q })
                );
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </section>

      {popular.length > 0 && (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
            Popular pets
          </h2>
          <ol className="mt-3 space-y-3">
            {popular.map((item) => (
              <li key={item.id}>
                <ResultCard item={item} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
