import { useEffect, useMemo, useState } from "react";
import type Fuse from "fuse.js";
import type { ItemCategory, SearchIndexItem, Variant } from "@shared/types";
import { parseSearchQuery } from "@shared/parseSearchQuery";
import { ResultCard } from "./ResultCard";
import { getCategoryTheme } from "@/lib/theme";

type Props = {
  fuse: Fuse<SearchIndexItem> | null;
  items: SearchIndexItem[];
  query: string;
  category?: ItemCategory | null;
  /** How many results to show in the first page. The user can load more in 25-row pages. */
  pageSize?: number;
};

export function SearchResults({
  fuse,
  items,
  query,
  category = null,
  pageSize = 25,
}: Props) {
  const parsed = useMemo(() => parseSearchQuery(query), [query]);

  /**
   * Compute the full ranked candidate list (not limited). We then slice down
   * to the user's current page size for rendering — this is fast even at
   * thousands of items because we never re-rank on "Show more".
   */
  const ranked = useMemo(() => {
    if (!parsed.normalizedQuery && !category) return [];

    let candidates: SearchIndexItem[];
    if (!parsed.normalizedQuery) {
      candidates = items;
    } else if (!fuse) {
      return [];
    } else {
      // Pull a generous Fuse window so category filtering doesn't starve the
      // list. We re-rank below.
      candidates = fuse
        .search(parsed.normalizedQuery, { limit: 500 })
        .map((h) => h.item);
    }

    if (category) {
      candidates = candidates.filter((i) => i.category === category);
    }

    const variant = parsed.requestedVariant;

    // If the user gave a specific variant: items that HAVE that variant float
    // to the top, then sort by that variant's value desc inside each group.
    if (variant) {
      return [...candidates].sort((a, b) => {
        const av = a.values[variant]?.valueRp;
        const bv = b.values[variant]?.valueRp;
        if (av != null && bv != null) return bv - av;
        if (av != null) return -1;
        if (bv != null) return 1;
        return 0;
      });
    }

    // No specific variant requested. If there's a text query we keep Fuse's
    // relevance order; for pure category browsing we sort by "top value" so
    // the most interesting items show up first.
    if (!parsed.normalizedQuery && category) {
      return [...candidates].sort((a, b) => topValueOf(b) - topValueOf(a));
    }

    return candidates;
  }, [fuse, items, parsed.normalizedQuery, parsed.requestedVariant, category]);

  // How many results to show. Resets to `pageSize` whenever the query or
  // category filter changes so the user always lands on the most relevant
  // top-N first.
  const [visibleCount, setVisibleCount] = useState(pageSize);
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [parsed.normalizedQuery, parsed.requestedVariant, category, pageSize]);

  if (!parsed.normalizedQuery && !category) {
    return <ExamplesPanel items={items} />;
  }

  const total = ranked.length;
  const visible = ranked.slice(0, visibleCount);

  if (visible.length === 0) {
    const what = query.trim()
      ? `\u201C${query}\u201D`
      : category
        ? `the ${getCategoryTheme(category).label} category`
        : "your search";
    return (
      <div className="rounded-3xl border-2 border-dashed border-brand-200 bg-white/70 p-8 text-center shadow-sm">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-bubble-100 text-3xl">
          <span aria-hidden className="text-bubble-500">?</span>
        </div>
        <p className="text-base font-bold text-slate-700">
          Nothing found for {what}.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Try fewer letters, or pick a different category.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-xs font-semibold text-slate-500">
        Showing <span className="text-slate-700">{visible.length}</span> of{" "}
        <span className="text-slate-700">{total}</span>{" "}
        {total === 1 ? "match" : "matches"}
      </p>

      <ol className="space-y-3">
        {visible.map((item, idx) => (
          <li
            key={item.id}
            style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }}
            className="animate-pop-in"
          >
            <ResultCard
              item={item}
              highlightVariant={parsed.requestedVariant as Variant | undefined}
            />
          </li>
        ))}
      </ol>

      {visibleCount < total && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((n) => n + pageSize)}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-bubble-500 px-5 py-2.5 text-sm font-extrabold text-white shadow-md ring-1 ring-white/60 transition hover:-translate-y-0.5 hover:shadow-lg active:scale-95"
          >
            Show {Math.min(pageSize, total - visibleCount)} more
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Pick the most representative value for an item when ranking pure category
 * browses. Pets get judged by their flashiest variant (Mega FR ≫ NFR ≫ FR ≫
 * regular); non-pet items just use "regular".
 */
function topValueOf(item: SearchIndexItem): number {
  return (
    item.values.mega_fly_ride?.valueRp ??
    item.values.mega_fly?.valueRp ??
    item.values.mega_ride?.valueRp ??
    item.values.mega?.valueRp ??
    item.values.neon_fly_ride?.valueRp ??
    item.values.neon_fly?.valueRp ??
    item.values.neon_ride?.valueRp ??
    item.values.neon?.valueRp ??
    item.values.fly_ride?.valueRp ??
    item.values.fly?.valueRp ??
    item.values.ride?.valueRp ??
    item.values.regular?.valueRp ??
    0
  );
}

const EXAMPLE_QUERIES: { label: string; chipClass: string }[] = [
  { label: "FR Shadow", chipClass: "from-brand-100 to-brand-200 text-brand-700" },
  { label: "NFR Frost", chipClass: "from-mint-100 to-mint-200 text-emerald-700" },
  { label: "MFR Owl", chipClass: "from-bubble-100 to-bubble-200 text-bubble-600" },
  { label: "Mega Turtle", chipClass: "from-purple-100 to-purple-200 text-purple-700" },
  { label: "Neon Cow", chipClass: "from-mint-50 to-mint-200 text-emerald-700" },
  { label: "Queen Bee", chipClass: "from-sunny-100 to-sunny-200 text-amber-700" },
];

function ExamplesPanel({ items }: { items: SearchIndexItem[] }) {
  const popular = items
    .filter((i) => i.category === "pet" && (i.values.fly_ride || i.values.neon_fly_ride))
    .sort((a, b) => topValueOf(b) - topValueOf(a))
    .slice(0, 4);

  return (
    <div className="space-y-7">
      <section>
        <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
          Try one of these
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLE_QUERIES.map((q, idx) => (
            <button
              key={q.label}
              type="button"
              style={{ animationDelay: `${idx * 40}ms` }}
              className={`animate-pop-in rounded-full bg-gradient-to-br ${q.chipClass} px-4 py-1.5 text-sm font-bold shadow-sm ring-1 ring-white/80 transition hover:-translate-y-0.5 hover:shadow-md active:scale-95`}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("amvc:example-query", { detail: q.label })
                );
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      </section>

      {popular.length > 0 && (
        <section>
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">
            Most valuable right now
          </h2>
          <ol className="mt-3 space-y-3">
            {popular.map((item, idx) => (
              <li
                key={item.id}
                style={{ animationDelay: `${idx * 60}ms` }}
                className="animate-pop-in"
              >
                <ResultCard item={item} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
