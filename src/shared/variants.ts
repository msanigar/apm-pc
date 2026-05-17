import type { Variant } from "./types";

export const ALL_VARIANTS: readonly Variant[] = [
  "regular",
  "ride",
  "fly",
  "fly_ride",
  "neon",
  "neon_ride",
  "neon_fly",
  "neon_fly_ride",
  "mega",
  "mega_ride",
  "mega_fly",
  "mega_fly_ride",
] as const;

export const VARIANT_LABELS: Record<Variant, string> = {
  regular: "Regular",
  ride: "Ride",
  fly: "Fly",
  fly_ride: "Fly Ride",
  neon: "Neon",
  neon_ride: "Neon Ride",
  neon_fly: "Neon Fly",
  neon_fly_ride: "Neon Fly Ride",
  mega: "Mega",
  mega_ride: "Mega Ride",
  mega_fly: "Mega Fly",
  mega_fly_ride: "Mega Fly Ride",
};

export const VARIANT_SHORT_LABELS: Record<Variant, string> = {
  regular: "Regular",
  ride: "R",
  fly: "F",
  fly_ride: "FR",
  neon: "N",
  neon_ride: "NR",
  neon_fly: "NF",
  neon_fly_ride: "NFR",
  mega: "M",
  mega_ride: "MR",
  mega_fly: "MF",
  mega_fly_ride: "MFR",
};

/**
 * Compose a Variant from its (modifier, form) parts.
 * Useful when generating variant lists programmatically.
 */
export type VariantModifier = "" | "neon" | "mega";
export type VariantForm = "regular" | "ride" | "fly" | "fly_ride";

export function composeVariant(
  modifier: VariantModifier,
  form: VariantForm
): Variant {
  if (modifier === "" && form === "regular") return "regular";
  if (modifier === "") return form as Variant;
  if (form === "regular") return modifier as Variant;
  return `${modifier}_${form}` as Variant;
}

/**
 * Returns the variants that make sense for a given item category.
 * - Pets get the full 12-variant matrix.
 * - Everything else uses only "regular".
 */
export function variantsForCategory(category: string): Variant[] {
  if (category === "pet") return [...ALL_VARIANTS];
  return ["regular"];
}

export function isValidVariant(value: string): value is Variant {
  return (ALL_VARIANTS as readonly string[]).includes(value);
}
