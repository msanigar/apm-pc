import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ItemDetailResponse } from "@shared/types";
import { fetchItem } from "@/lib/api";
import { VariantValueTable } from "@/components/VariantValueTable";
import { formatRelativeTime } from "@/lib/format";
import { getCategoryTheme, getRarityTheme } from "@/lib/theme";
import { ArrowLeftIcon, PawIcon, SparkleIcon } from "@/components/icons";

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
      <div className="rounded-3xl border border-white/80 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-bubble-400 text-white shadow-md animate-bounce-soft">
          <PawIcon size={26} />
        </div>
        <p className="mt-3 text-sm font-bold text-slate-600">Loading item…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-3xl border-2 border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
        Couldn’t load this item: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border-2 border-dashed border-brand-200 bg-white/70 p-8 text-center">
          <p className="text-base font-bold text-slate-700">
            We don’t have that item yet.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Try searching for something else.
          </p>
        </div>
        <BackLink />
      </div>
    );
  }

  const newest = newestCalculatedAt(data);
  const categoryTheme = getCategoryTheme(data.item.category);
  const rarityTheme = getRarityTheme(data.item.rarity);

  return (
    <article className="space-y-6">
      <BackLink />

      <header className="overflow-hidden rounded-3xl border border-white/80 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <ItemHero data={data} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-balance text-2xl font-black text-slate-900 sm:text-3xl">
                {data.item.name}
              </h1>
              {data.item.isHighTier && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-sunny-100 px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider text-amber-700 animate-sparkle"
                  title="High-tier item"
                >
                  <SparkleIcon size={12} /> High-tier
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${categoryTheme.badgeClass}`}
              >
                <categoryTheme.Icon size={14} />
                {categoryTheme.label}
              </span>
              {rarityTheme && (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 ${rarityTheme.badgeClass}`}
                >
                  {rarityTheme.label}
                </span>
              )}
            </div>

            {newest && (
              <p className="mt-3 text-xs font-medium text-slate-500">
                Values updated {formatRelativeTime(newest)}.
              </p>
            )}
          </div>
        </div>
      </header>

      <VariantValueTable category={data.item.category} values={data.values} />

      {data.item.aliases.length > 0 && (
        <p className="px-1 text-xs font-medium text-slate-500">
          Also known as:{" "}
          <span className="text-slate-700">{data.item.aliases.join(", ")}</span>
        </p>
      )}

      <ConfidenceLegend />
    </article>
  );
}

function BackLink() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 text-sm font-bold text-brand-700 shadow-sm ring-1 ring-white/80 transition hover:-translate-x-0.5 hover:bg-white"
    >
      <ArrowLeftIcon size={14} />
      Back to search
    </Link>
  );
}

function ConfidenceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/70 px-4 py-3 text-xs font-semibold text-slate-600 shadow-sm">
      <span className="text-slate-500">Confidence:</span>
      <Dot color="bg-emerald-500" label="High" />
      <Dot color="bg-amber-400" label="Medium" />
      <Dot color="bg-rose-400" label="Low" />
    </div>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ring-2 ring-white ${color}`} />
      {label}
    </span>
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
  const categoryTheme = getCategoryTheme(data.item.category);

  if (data.imageUrl) {
    return (
      <img
        src={data.imageUrl}
        alt=""
        className="h-24 w-24 shrink-0 rounded-2xl border-2 border-white bg-slate-50 object-cover shadow-md"
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`grid h-24 w-24 shrink-0 place-items-center rounded-2xl border-2 border-white shadow-md ${categoryTheme.iconBgClass}`}
    >
      <categoryTheme.Icon size={44} />
    </div>
  );
}
