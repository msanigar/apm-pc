import { Link } from "react-router-dom";
import type { SearchIndexItem, Variant } from "@shared/types";
import { VARIANT_SHORT_LABELS } from "@shared/variants";
import { formatRp } from "@/lib/format";

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

  return (
    <Link
      to={`/items/${item.slug}`}
      className="block rounded-2xl border border-white/5 bg-slate-900/50 p-4 transition hover:border-brand-500/60 hover:bg-slate-900/80"
    >
      <div className="flex items-start gap-3">
        <ItemThumbnail item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="truncate text-base font-semibold text-white">
              {item.name}
            </h3>
            <span className="text-xs text-slate-400">
              {categoryLabel(item.category)}
              {item.rarity ? ` · ${item.rarity}` : ""}
            </span>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {shownVariants.map(({ variant, value }) => (
              <li
                key={variant}
                className={`rounded-md border px-2 py-1 ${
                  variant === highlightVariant
                    ? "border-brand-400/60 bg-brand-700/20 text-white"
                    : "border-white/10 bg-slate-950/40 text-slate-300"
                }`}
              >
                <span className="font-medium text-slate-200">
                  {VARIANT_SHORT_LABELS[variant]}
                </span>
                <span className="ml-2 tabular-nums">{formatRp(value)}</span>
              </li>
            ))}
            {shownVariants.length === 0 && (
              <li className="text-slate-500">No values yet</li>
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

function ItemThumbnail({ item }: { item: SearchIndexItem }) {
  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-12 w-12 shrink-0 rounded-lg border border-white/10 bg-slate-950 object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-white/10 bg-slate-950 text-xs text-slate-500"
    >
      {item.name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()}
    </div>
  );
}
