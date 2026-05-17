import { useEffect, useState } from "react";
import { SearchBox } from "@/components/SearchBox";
import { SearchResults } from "@/components/SearchResults";
import { useSearchIndex } from "@/lib/useSearchIndex";
import { formatRelativeTime } from "@/lib/format";

export function HomePage() {
  const [query, setQuery] = useState("");
  const { items, fuse, isLoading, error, generatedAt } = useSearchIndex();

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
      <header className="space-y-3 pt-4">
        <h1 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Adopt Me value checker
        </h1>
        <p className="text-sm text-slate-400">
          Quick, ad-free RP estimates for pets and items, refreshed daily from
          multiple community sources.
        </p>
      </header>

      <SearchBox value={query} onChange={setQuery} />

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          Couldn’t load the search index: {error}
        </div>
      )}

      {isLoading && !error && items.length === 0 && (
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
          Loading values…
        </div>
      )}

      {!isLoading || items.length > 0 ? (
        <SearchResults fuse={fuse} items={items} query={query} />
      ) : null}

      {generatedAt && (
        <p className="text-xs text-slate-500">
          Index built {formatRelativeTime(generatedAt)}.
        </p>
      )}
    </section>
  );
}
