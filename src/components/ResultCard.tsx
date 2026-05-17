import { Link } from "react-router-dom";
import type { SearchIndexItem, Variant } from "@shared/types";
import { VARIANT_SHORT_LABELS } from "@shared/variants";
import { formatRp } from "@/lib/format";
import { getCategoryTheme, getRarityTheme, getVariantTheme } from "@/lib/theme";
import { SparkleIcon } from "@/components/icons";

type Props = {
  item: SearchIndexItem;
  highlightVariant?: Variant;
};

const QUICK_VARIANTS: Variant[] = [
  "regular",
  "fly_ride",
  "neon_fly_ride",
  "mega_fly_ride",
];

export function ResultCard({ item, highlightVariant }: Props) {
  const shownVariants = pickShownVariants(item, highlightVariant);
  const categoryTheme = getCategoryTheme(item.category);
  const rarityTheme = getRarityTheme(item.rarity);
  const isLegendary = item.rarity?.toLowerCase() === "legendary";

  return (
    <Link
      to={`/items/${item.slug}`}
      className="group relative block overflow-hidden rounded-3xl border border-white/80 bg-white p-4 shadow-sm transition will-change-transform hover:-translate-y-0.5 hover:shadow-xl"
    >
      {/* Soft hover backdrop tinted by category. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-50/0 via-white to-bubble-50/0 opacity-0 transition group-hover:opacity-100"
      />

      <div className="relative flex items-start gap-3">
        <ItemThumbnail item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-base font-extrabold text-slate-900 sm:text-lg">
              {item.name}
            </h3>
            {item.isHighTier && (
              <span
                aria-label="High-tier item"
                className="inline-flex h-5 items-center text-sunny-500 animate-sparkle"
                title="High-tier"
              >
                <SparkleIcon size={14} />
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${categoryTheme.badgeClass}`}
            >
              <categoryTheme.Icon size={12} />
              {categoryTheme.label}
            </span>
            {rarityTheme && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 ${rarityTheme.badgeClass} ${
                  isLegendary ? "animate-pop-in" : ""
                }`}
              >
                {rarityTheme.label}
              </span>
            )}
          </div>

          <ul className="mt-3 flex flex-wrap gap-1.5">
            {shownVariants.map(({ variant, value }) => {
              const tint = getVariantTheme(variant);
              const isHighlight = variant === highlightVariant;
              return (
                <li
                  key={variant}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-bold transition ${tint.className} ${
                    isHighlight ? "ring-2 ring-offset-1 ring-brand-400" : ""
                  } ${isHighlight && tint.glowClass ? tint.glowClass : ""}`}
                >
                  <span className="font-extrabold uppercase tracking-wide opacity-80">
                    {VARIANT_SHORT_LABELS[variant]}
                  </span>
                  <span className="tabular-nums">{formatRp(value)}</span>
                </li>
              );
            })}
            {shownVariants.length === 0 && (
              <li className="text-xs italic text-slate-400">No values yet</li>
            )}
          </ul>
        </div>
      </div>
    </Link>
  );
}

function pickShownVariants(item: SearchIndexItem, highlight?: Variant) {
  const ordered: Variant[] = [];
  if (highlight && item.values[highlight]) ordered.push(highlight);
  for (const v of QUICK_VARIANTS) {
    if (v === highlight) continue;
    if (item.values[v]) ordered.push(v);
  }
  return ordered
    .slice(0, 4)
    .map((variant) => ({ variant, value: item.values[variant]?.valueRp ?? null }));
}

function ItemThumbnail({ item }: { item: SearchIndexItem }) {
  const categoryTheme = getCategoryTheme(item.category);

  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-14 w-14 shrink-0 rounded-2xl border-2 border-white bg-slate-50 object-cover shadow-sm"
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl border-2 border-white shadow-sm ${categoryTheme.iconBgClass}`}
    >
      <categoryTheme.Icon size={24} />
    </div>
  );
}
