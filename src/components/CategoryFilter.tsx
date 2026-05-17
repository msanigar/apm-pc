import type { ComponentType, SVGProps } from "react";
import type { ItemCategory } from "@shared/types";
import { CATEGORY_OPTIONS } from "@/lib/theme";

type Props = {
  selected: ItemCategory | null;
  onSelect: (category: ItemCategory | null) => void;
};

const CATEGORY_ORDER: ItemCategory[] = [
  "pet",
  "vehicle",
  "egg",
  "pet_wear",
  "stroller",
  "toy",
  "food",
  "potion",
  "gift",
];

const ORDERED = CATEGORY_ORDER.map((key) =>
  CATEGORY_OPTIONS.find((o) => o.key === key)!
).filter(Boolean);

export function CategoryFilter({ selected, onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <CategoryPill
        isActive={selected === null}
        onClick={() => onSelect(null)}
        label="All"
        activeClass="bg-gradient-to-br from-brand-500 to-bubble-500 text-white shadow-md"
        inactiveClass="bg-white text-slate-700 ring-1 ring-slate-200"
      />
      {ORDERED.map(({ key, theme }) => {
        const isActive = selected === key;
        return (
          <CategoryPill
            key={key}
            isActive={isActive}
            onClick={() => onSelect(isActive ? null : key)}
            label={theme.label}
            Icon={theme.Icon}
            activeClass={`${theme.badgeClass} ring-2 ring-offset-1 ring-current shadow-md`}
            inactiveClass="bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          />
        );
      })}
    </div>
  );
}

type PillProps = {
  isActive: boolean;
  onClick: () => void;
  label: string;
  Icon?: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  activeClass: string;
  inactiveClass: string;
};

function CategoryPill({
  isActive,
  onClick,
  label,
  Icon,
  activeClass,
  inactiveClass,
}: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-bold transition active:scale-95 ${
        isActive ? activeClass : inactiveClass
      }`}
    >
      {Icon && <Icon size={14} />}
      {label}
    </button>
  );
}
