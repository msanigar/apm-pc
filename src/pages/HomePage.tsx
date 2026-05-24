import { useEffect, useMemo, useState } from "react";
import type { ItemCategory } from "@shared/types";
import { CategoryFilter } from "@/components/CategoryFilter";
import { RarityFilter, normalizeRarity } from "@/components/RarityFilter";
import { SearchBox } from "@/components/SearchBox";
import { SearchResults } from "@/components/SearchResults";
import { useSearchIndex } from "@/lib/useSearchIndex";
import { formatRelativeTime } from "@/lib/format";
import { PawIcon } from "@/components/icons";

export function HomePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ItemCategory | null>(null);
  const [rarity, setRarity] = useState<string | null>(null);
  const { items, fuse, isLoading, error, generatedAt } = useSearchIndex();

  // Only show filter chips for categories that actually have items in this
  // dataset. Otherwise we'd tease the user with empty buckets like "Food".
  const availableCategories = useMemo(() => {
    const set = new Set<ItemCategory>();
    for (const item of items) set.add(item.category);
    return set;
  }, [items]);

  // Rarities present in the visible dataset, intersected with the active
  // category. E.g. browsing "Egg" should only show "Legendary" (every
  // current egg is legendary). Items without a rarity are skipped.
  const availableRarities = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (category && item.category !== category) continue;
      const r = normalizeRarity(item.rarity);
      if (r) set.add(r);
    }
    return set;
  }, [items, category]);

  useEffect(() => {
    function onExample(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string") setQuery(detail);
    }
    window.addEventListener("amvc:example-query", onExample);
    return () => window.removeEventListener("amvc:example-query", onExample);
  }, []);

  return (
    <section className="space-y-6">
      <header className="space-y-2 pt-2">
        <h1 className="text-balance text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
          What’s it{" "}
          <span className="bg-gradient-to-r from-brand-500 via-bubble-500 to-sunny-500 bg-clip-text text-transparent">
            worth?
          </span>
        </h1>
        <p className="text-sm font-medium text-slate-600 sm:text-base">
          Quick, ad-free RP values for every Adopt Me pet and item — refreshed
          daily from a handful of community sources.
        </p>
      </header>

      <SearchBox
        value={query}
        onChange={setQuery}
        className="hidden md:block"
      />

      <div className="space-y-2">
        <h2 className="px-1 text-xs font-extrabold uppercase tracking-widest text-slate-500">
          Filter by type
        </h2>
        <CategoryFilter
          selected={category}
          onSelect={(next) => {
            setCategory(next);
            // If switching to a category that no longer contains the active
            // rarity, drop the rarity filter rather than starve the results.
            if (next && rarity) {
              const stillAvailable = items.some(
                (i) =>
                  i.category === next && normalizeRarity(i.rarity) === rarity
              );
              if (!stillAvailable) setRarity(null);
            }
          }}
          availableCategories={availableCategories}
        />
      </div>

      <div className="space-y-2">
        <h2 className="px-1 text-xs font-extrabold uppercase tracking-widest text-slate-500">
          Filter by rarity
        </h2>
        <RarityFilter
          selected={rarity}
          onSelect={setRarity}
          availableRarities={availableRarities}
        />
      </div>

      <SearchBox
        value={query}
        onChange={setQuery}
        className="md:hidden"
        autoFocus={false}
      />

      {error && (
        <div className="rounded-3xl border-2 border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          Hmm, couldn’t load the search index: {error}
        </div>
      )}

      {isLoading && !error && items.length === 0 && <LoadingState />}

      {(!isLoading || items.length > 0) && (
        <SearchResults
          fuse={fuse}
          items={items}
          query={query}
          category={category}
          rarity={rarity}
          onClearCategory={() => setCategory(null)}
          onClearRarity={() => setRarity(null)}
        />
      )}

      {generatedAt && (
        <p className="pt-2 text-center text-xs font-medium text-slate-400">
          Index built {formatRelativeTime(generatedAt)}.
        </p>
      )}
    </section>
  );
}

function LoadingState() {
  return (
    <div className="rounded-3xl border border-white/80 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-bubble-400 text-white shadow-md animate-bounce-soft">
        <PawIcon size={26} />
      </div>
      <p className="mt-3 text-sm font-bold text-slate-600">Loading values…</p>
      <p className="text-xs text-slate-400">Fetching today’s prices.</p>
    </div>
  );
}
