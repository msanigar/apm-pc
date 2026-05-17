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

export type ItemDetailResponse = {
  item: Item;
  imageUrl?: string | null;
  values: AggregatedVariantValue[];
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
