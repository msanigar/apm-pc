import { getRarityTheme } from "@/lib/theme";

type Props = {
  selected: string | null;
  onSelect: (rarity: string | null) => void;
  /**
   * Rarities present in the current dataset (e.g. intersected with the
   * active category). When set, only matching pills render — except an
   * already-active pill remains visible so the user can always deselect.
   */
  availableRarities?: ReadonlySet<string>;
};

/**
 * Canonical rarity strings stored in lowercase-with-spaces form. This matches
 * how `theme.ts` keys its `RARITY_THEME` map, and is what `normalizeRarity`
 * coerces any rarity input into (so "Ultra-Rare" and "ultra rare" both land
 * on "ultra rare").
 */
const RARITY_ORDER = [
  "common",
  "uncommon",
  "rare",
  "ultra rare",
  "legendary",
] as const;

export function RarityFilter({ selected, onSelect, availableRarities }: Props) {
  const visible = RARITY_ORDER.filter(
    (r) => !availableRarities || availableRarities.has(r) || r === selected
  );
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {visible.map((rarity) => {
        const theme = getRarityTheme(rarity)!;
        const isActive = selected === rarity;
        return (
          <button
            key={rarity}
            type="button"
            onClick={() => onSelect(isActive ? null : rarity)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-bold transition active:scale-95 ${
              isActive
                ? `${theme.badgeClass} ring-2 ring-offset-1 ring-current shadow-md`
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
            aria-pressed={isActive}
          >
            <span
              aria-hidden
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${rarityDotClass(rarity)}`}
            />
            {theme.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Normalise any rarity string a source might emit into our canonical form.
 * Handles "Ultra-Rare", "ULTRA_RARE", " Ultra  Rare ", etc.
 *
 * Exported so `SearchResults` (and any future consumer) can compare against
 * a `SearchIndexItem`'s `rarity` field directly.
 */
export function normalizeRarity(
  rarity: string | null | undefined
): string | null {
  if (!rarity) return null;
  return rarity.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

function rarityDotClass(rarity: string): string {
  switch (rarity) {
    case "common":
      return "bg-slate-400";
    case "uncommon":
      return "bg-mint-400";
    case "rare":
      return "bg-sky-400";
    case "ultra rare":
      return "bg-purple-400";
    case "legendary":
      return "bg-gradient-to-r from-sunny-400 via-bubble-400 to-brand-400";
    default:
      return "bg-slate-300";
  }
}
