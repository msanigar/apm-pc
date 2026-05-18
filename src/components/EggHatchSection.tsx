import { Link } from "react-router-dom";
import type { EggHatchOdds, EggHatchPet, HatchRarity } from "@shared/types";
import { getRarityTheme } from "@/lib/theme";
import { formatRelativeTime } from "@/lib/format";
import { CategoryEggIcon, SparkleIcon } from "@/components/icons";

type Props = {
  odds: EggHatchOdds[];
  pets: EggHatchPet[];
  fetchedAt?: string | null;
  source?: string | null;
};

const TIER_ORDER: HatchRarity[] = [
  "common",
  "uncommon",
  "rare",
  "ultra_rare",
  "legendary",
];

const TIER_LABEL: Record<HatchRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  ultra_rare: "Ultra Rare",
  legendary: "Legendary",
};

const TIER_BAR_CLASS: Record<HatchRarity, string> = {
  common: "bg-slate-300",
  uncommon: "bg-mint-300",
  rare: "bg-sky-300",
  ultra_rare: "bg-purple-300",
  legendary: "bg-gradient-to-r from-sunny-300 via-bubble-300 to-brand-300",
};

const TIER_LABEL_CLASS: Record<HatchRarity, string> = {
  common: "text-slate-700",
  uncommon: "text-emerald-700",
  rare: "text-sky-700",
  ultra_rare: "text-purple-700",
  legendary: "text-amber-700",
};

export function EggHatchSection({ odds, pets, fetchedAt, source }: Props) {
  const oddsByTier = new Map<HatchRarity, number | null>();
  for (const o of odds) oddsByTier.set(o.rarity, o.probabilityPct);

  // Group pets by rarity in canonical order.
  const petsByTier = new Map<HatchRarity, EggHatchPet[]>();
  for (const tier of TIER_ORDER) petsByTier.set(tier, []);
  for (const p of pets) {
    const list = petsByTier.get(p.rarity);
    if (list) list.push(p);
  }

  const hasAnyOdds = odds.some((o) => o.probabilityPct != null);
  const tiersWithContent = TIER_ORDER.filter(
    (t) => (petsByTier.get(t)?.length ?? 0) > 0 || oddsByTier.get(t) != null
  );

  if (tiersWithContent.length === 0) return null;

  return (
    <section className="space-y-4 rounded-3xl border border-white/80 bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-extrabold tracking-tight text-slate-900">
          <span className="grid h-7 w-7 place-items-center rounded-xl bg-sunny-100 text-amber-600">
            <CategoryEggIcon size={14} />
          </span>
          Hatches into
          <span className="ml-1 text-sm font-bold text-slate-500">
            ({pets.length} {pets.length === 1 ? "pet" : "pets"})
          </span>
        </h2>
        {(source || fetchedAt) && (
          <p className="text-[11px] font-semibold text-slate-400">
            {source === "fandom_wiki" ? "Source: Adopt Me Wiki" : source}
            {fetchedAt && (
              <span className="ml-1">· updated {formatRelativeTime(fetchedAt)}</span>
            )}
          </p>
        )}
      </header>

      {hasAnyOdds && <TierOddsBar oddsByTier={oddsByTier} />}

      <div className="space-y-3">
        {tiersWithContent.map((tier) => {
          const list = petsByTier.get(tier) ?? [];
          const pct = oddsByTier.get(tier);
          return (
            <div key={tier} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h3
                  className={`text-xs font-extrabold uppercase tracking-widest ${TIER_LABEL_CLASS[tier]}`}
                >
                  {TIER_LABEL[tier]}
                </h3>
                {pct != null && (
                  <span className="text-xs font-bold tabular-nums text-slate-500">
                    {formatPct(pct)}
                  </span>
                )}
              </div>
              {list.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {list.map((pet, i) => (
                    <li key={`${pet.petSlug ?? pet.petName}-${i}`}>
                      <PetChip pet={pet} tier={tier} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-1 text-xs italic text-slate-400">
                  No pets listed in this tier.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TierOddsBar({ oddsByTier }: { oddsByTier: Map<HatchRarity, number | null> }) {
  const total = TIER_ORDER.reduce((s, t) => s + (oddsByTier.get(t) ?? 0), 0);
  if (total <= 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
        {TIER_ORDER.map((tier) => {
          const pct = oddsByTier.get(tier);
          if (!pct || pct <= 0) return null;
          const widthPct = (pct / total) * 100;
          return (
            <div
              key={tier}
              className={`${TIER_BAR_CLASS[tier]}`}
              style={{ width: `${widthPct}%` }}
              title={`${TIER_LABEL[tier]}: ${formatPct(pct)}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] font-semibold">
        {TIER_ORDER.map((tier) => {
          const pct = oddsByTier.get(tier);
          if (pct == null) return null;
          return (
            <span key={tier} className={TIER_LABEL_CLASS[tier]}>
              <span
                aria-hidden
                className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${TIER_BAR_CLASS[tier]}`}
              />
              {TIER_LABEL[tier]} {formatPct(pct)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PetChip({ pet, tier }: { pet: EggHatchPet; tier: HatchRarity }) {
  const rarityTheme = getRarityTheme(rarityLabelFor(tier));
  const isLegendary = tier === "legendary";
  const chipBase =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition active:scale-95";
  const themed = rarityTheme?.badgeClass ?? "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200";

  const content = (
    <>
      {pet.imageUrl ? (
        <img
          src={pet.imageUrl}
          alt=""
          className="h-4 w-4 shrink-0 rounded-md border border-white object-cover"
        />
      ) : (
        <span className="h-4 w-4 shrink-0 rounded-md bg-white/70 ring-1 ring-white" />
      )}
      <span className="truncate">{pet.petName}</span>
      {isLegendary && (
        <span className="text-sunny-500 animate-sparkle" aria-hidden>
          <SparkleIcon size={10} />
        </span>
      )}
    </>
  );

  if (pet.petSlug) {
    return (
      <Link
        to={`/items/${pet.petSlug}`}
        className={`${chipBase} ${themed} hover:-translate-y-0.5 hover:shadow-md`}
      >
        {content}
      </Link>
    );
  }
  return (
    <span
      className={`${chipBase} cursor-not-allowed opacity-70 ${themed}`}
      title="This pet isn't in our catalog yet."
    >
      {content}
    </span>
  );
}

function rarityLabelFor(tier: HatchRarity): string {
  if (tier === "ultra_rare") return "ultra rare";
  return tier;
}

function formatPct(pct: number): string {
  if (Number.isInteger(pct)) return `${pct}%`;
  return `${pct.toFixed(1)}%`;
}
