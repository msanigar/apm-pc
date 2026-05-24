/**
 * Shared types used by both the frontend and Netlify Functions.
 *
 * Keep this file free of runtime dependencies (no DOM, no Node-only APIs) so it
 * can be imported from anywhere in the project.
 */

export type ItemCategory =
  | "pet"
  | "egg"
  | "vehicle"
  | "toy"
  | "stroller"
  | "pet_wear"
  | "food"
  | "gift"
  | "potion"
  | "other";

export type Variant =
  | "regular"
  | "ride"
  | "fly"
  | "fly_ride"
  | "neon"
  | "neon_ride"
  | "neon_fly"
  | "neon_fly_ride"
  | "mega"
  | "mega_ride"
  | "mega_fly"
  | "mega_fly_ride";

export type Confidence = "low" | "medium" | "high";

export type ValueStateLabel =
  | "stable"
  | "updated_today"
  | "stale"
  | "held_suspicious"
  | "low_confidence"
  | "new";

export type Item = {
  id: string;
  slug: string;
  name: string;
  category: ItemCategory;
  rarity?: string | null;
  aliases: string[];
  imagePath?: string | null;
  isHighTier: boolean;
};

export type AggregatedVariantValue = {
  variant: Variant;
  valueRp: number;
  minRp?: number | null;
  maxRp?: number | null;
  sourceCount: number;
  confidence: Confidence;
  isSuspicious: boolean;
  lastAcceptedAt?: string | null;
  lastCandidateValueRp?: number | null;
  lastCandidateAt?: string | null;
  calculatedAt: string;
};

/**
 * Compact item shape used by the client-side Fuse.js search index.
 * Keep this small so it fits in a single response and parses quickly.
 */
export type SearchIndexItem = {
  id: string;
  slug: string;
  name: string;
  category: ItemCategory;
  rarity?: string | null;
  aliases: string[];
  isHighTier: boolean;
  imageUrl?: string | null;
  values: Partial<Record<Variant, AggregatedVariantValue>>;
};

export type SearchIndexResponse = {
  generatedAt: string;
  items: SearchIndexItem[];
};

/**
 * Hatch rarity tier as published by the Adopt Me wiki. The string values match
 * the `text` rarities stored in `egg_hatch_odds` / `egg_hatch_pets`.
 */
export type HatchRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "ultra_rare"
  | "legendary";

export type EggHatchOdds = {
  rarity: HatchRarity;
  probabilityPct: number | null;
};

export type EggHatchPet = {
  /** Slug if the pet is in our catalog, otherwise null (linked chip will be greyed). */
  petSlug: string | null;
  petName: string;
  rarity: HatchRarity;
  imageUrl?: string | null;
};

export type HatchedFromEgg = {
  eggSlug: string;
  eggName: string;
  rarity: HatchRarity;
};

/**
 * How a pet entered the game outside of egg hatching. The kinds mirror
 * the `pet_acquisitions.kind` enum in Supabase.
 */
export type AcquisitionKind =
  | "event"
  | "robux"
  | "paid"
  | "task"
  | "gift"
  | "other";

export type PetAcquisition = {
  kind: AcquisitionKind;
  eventName?: string | null;
  eventYear?: number | null;
  currency?: string | null;
  cost?: number | null;
  retired: boolean;
  releasedAt?: string | null;
  notes?: string | null;
  source: string;
};

/**
 * One row in a container item's contents (RGB Reward Box → RGB Sword, etc.)
 */
export type ItemContent = {
  containedSlug: string | null;
  containedName: string;
  rarity?: HatchRarity | null;
  /** Wiki-tagged subcategory ("pet", "toy", "accessory" …). Best-effort. */
  categoryHint?: string | null;
  dropChancePct?: number | null;
  quantity: number;
  imageUrl?: string | null;
};

/** Reverse lookup: this item is contained in these other items. */
export type ContainedIn = {
  containerSlug: string;
  containerName: string;
  containerImageUrl?: string | null;
  dropChancePct?: number | null;
};

export type ItemDetailResponse = {
  item: Item;
  imageUrl?: string | null;
  values: AggregatedVariantValue[];
  /** Populated when `item.category === 'egg'`. */
  hatchesInto?: {
    odds: EggHatchOdds[];
    pets: EggHatchPet[];
    /** Last-fetched-at across all hatch rows for this egg, ISO 8601. */
    fetchedAt?: string | null;
    /** Adapter name (e.g. "fandom_wiki"). Single source for now. */
    source?: string | null;
  };
  /** Populated when `item.category === 'pet'`. */
  hatchesFrom?: HatchedFromEgg[];
  /** Populated when `item.category === 'pet'` and the pet has non-egg
   * acquisition records (event releases, Robux purchases, etc.). */
  acquisitions?: PetAcquisition[];
  /** Populated when the item itself is a container — boxes, gifts, etc. */
  contents?: {
    items: ItemContent[];
    odds?: EggHatchOdds[];
    fetchedAt?: string | null;
    source?: string | null;
  };
  /** Reverse lookup: items that contain THIS item (e.g. RGB Sword shows
   * "Obtained from RGB Reward Box"). */
  containedIn?: ContainedIn[];
};

/**
 * Raw normalised value coming from one source on one item/variant.
 * This is what the diff/validation pipeline consumes.
 */
export type CandidateRow = {
  itemSlug: string;
  variant: Variant;
  values: number[];
  sources: string[];
};

export type CandidateDataset = {
  rows: CandidateRow[];
  sourceNames: string[];
};

/**
 * Snapshot of the live aggregated table used as a baseline during diffing.
 */
export type LiveRow = {
  itemSlug: string;
  variant: Variant;
  valueRp: number;
  sourceCount: number;
  isSuspicious: boolean;
  lastAcceptedAt?: string | null;
  isHighTier?: boolean;
};

export type LiveDataset = {
  rows: LiveRow[];
};

export type ImportRunStatus =
  | "running"
  | "promoted"
  | "partial"
  | "rejected"
  | "failed";

export type ImportRunSummary = {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  status: ImportRunStatus;
  sourceCount?: number | null;
  itemCount?: number | null;
  promotedCount: number;
  heldBackCount: number;
  suspiciousCount: number;
  missingCount: number;
  notes?: string | null;
};
