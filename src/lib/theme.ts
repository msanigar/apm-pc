/**
 * Category and rarity → visual style mapping. Centralised so every place
 * that renders an item (cards, detail page, variant chips) picks the same
 * colours and icons.
 */
import type { ComponentType, SVGProps } from "react";
import type { ItemCategory, Variant } from "@shared/types";
import {
  CategoryEggIcon,
  CategoryFoodIcon,
  CategoryGiftIcon,
  CategoryOtherIcon,
  CategoryPetIcon,
  CategoryPetWearIcon,
  CategoryPotionIcon,
  CategoryStrollerIcon,
  CategoryToyIcon,
  CategoryVehicleIcon,
} from "@/components/icons";

export type CategoryTheme = {
  label: string;
  /** Tailwind utility classes for the soft badge background + text. */
  badgeClass: string;
  /** Tailwind class for the icon tint when shown in a card thumbnail. */
  iconBgClass: string;
  /** Component for the icon itself. */
  Icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
};

const CATEGORY_THEME: Record<ItemCategory, CategoryTheme> = {
  pet: {
    label: "Pet",
    badgeClass: "bg-brand-100 text-brand-700",
    iconBgClass: "bg-brand-100 text-brand-600",
    Icon: CategoryPetIcon,
  },
  egg: {
    label: "Egg",
    badgeClass: "bg-sunny-100 text-amber-700",
    iconBgClass: "bg-sunny-100 text-amber-600",
    Icon: CategoryEggIcon,
  },
  vehicle: {
    label: "Vehicle",
    badgeClass: "bg-sky-100 text-sky-700",
    iconBgClass: "bg-sky-100 text-sky-600",
    Icon: CategoryVehicleIcon,
  },
  toy: {
    label: "Toy",
    badgeClass: "bg-bubble-100 text-bubble-600",
    iconBgClass: "bg-bubble-100 text-bubble-600",
    Icon: CategoryToyIcon,
  },
  stroller: {
    label: "Stroller",
    badgeClass: "bg-purple-100 text-purple-700",
    iconBgClass: "bg-purple-100 text-purple-600",
    Icon: CategoryStrollerIcon,
  },
  pet_wear: {
    label: "Pet wear",
    badgeClass: "bg-teal-100 text-teal-700",
    iconBgClass: "bg-teal-100 text-teal-600",
    Icon: CategoryPetWearIcon,
  },
  food: {
    label: "Food",
    badgeClass: "bg-orange-100 text-orange-700",
    iconBgClass: "bg-orange-100 text-orange-600",
    Icon: CategoryFoodIcon,
  },
  gift: {
    label: "Gift",
    badgeClass: "bg-rose-100 text-rose-700",
    iconBgClass: "bg-rose-100 text-rose-600",
    Icon: CategoryGiftIcon,
  },
  potion: {
    label: "Potion",
    badgeClass: "bg-mint-100 text-emerald-700",
    iconBgClass: "bg-mint-100 text-emerald-600",
    Icon: CategoryPotionIcon,
  },
  other: {
    label: "Other",
    badgeClass: "bg-slate-100 text-slate-700",
    iconBgClass: "bg-slate-100 text-slate-600",
    Icon: CategoryOtherIcon,
  },
};

export function getCategoryTheme(category: string): CategoryTheme {
  return CATEGORY_THEME[category as ItemCategory] ?? CATEGORY_THEME.other;
}

export const CATEGORY_OPTIONS: { key: ItemCategory; theme: CategoryTheme }[] = (
  Object.keys(CATEGORY_THEME) as ItemCategory[]
).map((key) => ({ key, theme: CATEGORY_THEME[key] }));

/* ───────────────────────── Rarity ───────────────────────── */

export type RarityTheme = {
  label: string;
  /** Soft badge classes for use inside cards. */
  badgeClass: string;
  /** Stronger ring/glow class used when we want it to "shine". */
  glowClass?: string;
};

const RARITY_THEME: Record<string, RarityTheme> = {
  common: {
    label: "Common",
    badgeClass: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  },
  uncommon: {
    label: "Uncommon",
    badgeClass: "bg-mint-100 text-emerald-700 ring-1 ring-inset ring-mint-300",
  },
  rare: {
    label: "Rare",
    badgeClass: "bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-300",
  },
  "ultra rare": {
    label: "Ultra Rare",
    badgeClass:
      "bg-purple-100 text-purple-700 ring-1 ring-inset ring-purple-300",
  },
  legendary: {
    label: "Legendary",
    badgeClass:
      "bg-gradient-to-r from-sunny-200 via-bubble-100 to-brand-200 text-amber-900 ring-1 ring-inset ring-sunny-300",
    glowClass: "glow-legendary",
  },
};

export function getRarityTheme(rarity: string | null | undefined): RarityTheme | null {
  if (!rarity) return null;
  return RARITY_THEME[rarity.toLowerCase()] ?? {
    label: rarity.replace(/\b\w/g, (c) => c.toUpperCase()),
    badgeClass: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
  };
}

/* ───────────────────────── Variants ───────────────────────── */

/**
 * Visual treatment per variant. Regular/Ride/Fly = neutral. Neon variants
 * pick up a green glow. Mega variants pick up a pink glow. Other (Fly Ride
 * etc.) get a subtle brand-blue tint so the user can scan the chips quickly.
 */
export type VariantTheme = {
  label: string;
  className: string;
  /** Optional extra class (e.g. glow-neon) applied to a "special" chip. */
  glowClass?: string;
};

const VARIANT_TINT: Partial<Record<Variant, Pick<VariantTheme, "className" | "glowClass">>> = {
  regular: {
    className: "bg-white text-slate-700 ring-1 ring-slate-200",
  },
  ride: {
    className: "bg-brand-50 text-brand-700 ring-1 ring-brand-100",
  },
  fly: {
    className: "bg-sky-50 text-sky-700 ring-1 ring-sky-100",
  },
  fly_ride: {
    className:
      "bg-gradient-to-br from-sky-50 to-brand-100 text-brand-700 ring-1 ring-brand-200",
  },
  neon: {
    className: "bg-mint-50 text-emerald-700 ring-1 ring-mint-200",
    glowClass: "glow-neon",
  },
  neon_ride: {
    className: "bg-mint-50 text-emerald-700 ring-1 ring-mint-200",
    glowClass: "glow-neon",
  },
  neon_fly: {
    className: "bg-mint-50 text-emerald-700 ring-1 ring-mint-200",
    glowClass: "glow-neon",
  },
  neon_fly_ride: {
    className: "bg-mint-100 text-emerald-700 ring-1 ring-mint-300",
    glowClass: "glow-neon",
  },
  mega: {
    className: "bg-bubble-50 text-bubble-600 ring-1 ring-bubble-200",
    glowClass: "glow-mega",
  },
  mega_ride: {
    className: "bg-bubble-50 text-bubble-600 ring-1 ring-bubble-200",
    glowClass: "glow-mega",
  },
  mega_fly: {
    className: "bg-bubble-50 text-bubble-600 ring-1 ring-bubble-200",
    glowClass: "glow-mega",
  },
  mega_fly_ride: {
    className: "bg-bubble-100 text-bubble-600 ring-1 ring-bubble-300",
    glowClass: "glow-mega",
  },
};

export function getVariantTheme(variant: Variant): {
  className: string;
  glowClass?: string;
} {
  return VARIANT_TINT[variant] ?? VARIANT_TINT.regular!;
}
