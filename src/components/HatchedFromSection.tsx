import { Link } from "react-router-dom";
import type { HatchedFromEgg, HatchRarity } from "@shared/types";
import { CategoryEggIcon } from "@/components/icons";
import { getRarityTheme } from "@/lib/theme";

type Props = {
  eggs: HatchedFromEgg[];
};

const TIER_LABEL: Record<HatchRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  ultra_rare: "Ultra Rare",
  legendary: "Legendary",
};

export function HatchedFromSection({ eggs }: Props) {
  if (eggs.length === 0) return null;
  return (
    <section className="space-y-2 rounded-3xl border border-white/80 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 px-1 text-xs font-extrabold uppercase tracking-widest text-slate-500">
        <span className="grid h-5 w-5 place-items-center rounded-lg bg-sunny-100 text-amber-600">
          <CategoryEggIcon size={11} />
        </span>
        Hatches from
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {eggs.map((e, i) => {
          const rarityTheme = getRarityTheme(rarityLabelFor(e.rarity));
          return (
            <li key={`${e.eggSlug}-${i}`}>
              <Link
                to={`/items/${e.eggSlug}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:bg-sunny-50 hover:text-amber-700 hover:ring-sunny-200 active:scale-95"
              >
                <CategoryEggIcon size={12} className="text-amber-500" />
                {e.eggName}
                <span
                  className={`-mr-1 ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                    rarityTheme?.badgeClass ?? "bg-slate-100 text-slate-600"
                  }`}
                >
                  {TIER_LABEL[e.rarity]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function rarityLabelFor(tier: HatchRarity): string {
  if (tier === "ultra_rare") return "ultra rare";
  return tier;
}
