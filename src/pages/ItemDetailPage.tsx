import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ItemDetailResponse } from "@shared/types";
import { fetchItem } from "@/lib/api";
import { VariantValueTable } from "@/components/VariantValueTable";
import { formatRelativeTime } from "@/lib/format";

export function ItemDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [data, setData] = useState<ItemDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setData(null);
    fetchItem(slug)
      .then((res) => {
        if (cancelled) return;
        setData(res);
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
  }, [slug]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
        Loading item…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
        Couldn’t load this item: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
          We don’t have that item yet.
        </div>
        <Link to="/" className="text-sm text-brand-300 hover:underline">
          ← Back to search
        </Link>
      </div>
    );
  }

  const newest = newestCalculatedAt(data);

  return (
    <article className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-brand-300 hover:underline"
      >
        ← Back to search
      </Link>

      <header className="flex items-start gap-4">
        <ItemHero data={data} />
        <div className="min-w-0 flex-1">
          <h1 className="text-balance text-2xl font-semibold text-white sm:text-3xl">
            {data.item.name}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {categoryLabel(data.item.category)}
            {data.item.rarity ? ` · ${data.item.rarity}` : ""}
            {data.item.isHighTier ? " · high-tier" : ""}
          </p>
          {newest && (
            <p className="mt-1 text-xs text-slate-500">
              Values updated {formatRelativeTime(newest)}.
            </p>
          )}
        </div>
      </header>

      <VariantValueTable category={data.item.category} values={data.values} />

      {data.item.aliases.length > 0 && (
        <p className="text-xs text-slate-500">
          Also known as:{" "}
          <span className="text-slate-300">{data.item.aliases.join(", ")}</span>
        </p>
      )}
    </article>
  );
}

function newestCalculatedAt(data: ItemDetailResponse): string | null {
  let best = 0;
  let bestIso: string | null = null;
  for (const v of data.values) {
    const ts = new Date(v.calculatedAt).getTime();
    if (Number.isFinite(ts) && ts > best) {
      best = ts;
      bestIso = v.calculatedAt;
    }
  }
  return bestIso;
}

function ItemHero({ data }: { data: ItemDetailResponse }) {
  if (data.imageUrl) {
    return (
      <img
        src={data.imageUrl}
        alt=""
        className="h-20 w-20 shrink-0 rounded-2xl border border-white/10 bg-slate-950 object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border border-white/10 bg-slate-950 text-lg font-semibold text-slate-400"
    >
      {data.item.name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()}
    </div>
  );
}

function categoryLabel(category: string): string {
  switch (category) {
    case "pet":
      return "Pet";
    case "egg":
      return "Egg";
    case "vehicle":
      return "Vehicle";
    case "toy":
      return "Toy";
    case "stroller":
      return "Stroller";
    case "pet_wear":
      return "Pet wear";
    case "food":
      return "Food";
    case "gift":
      return "Gift";
    case "potion":
      return "Potion";
    default:
      return "Other";
  }
}
