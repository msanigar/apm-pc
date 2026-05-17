import type { ItemCategory, Variant } from "../../shared/types";

/**
 * Hand-tuned mock data shared by all three mock adapters.
 *
 * Each adapter applies its own small "skew" to the canonical values to
 * simulate real-world disagreement between community trade-value sites. With
 * 3 adapters and a median aggregation, outliers get rejected — which is the
 * exact behaviour we want to demonstrate.
 */
export type MockItem = {
  slug: string;
  name: string;
  category: ItemCategory;
  rarity?: string;
  isHighTier?: boolean;
  imageUrl?: string;
  aliases?: string[];
  /** Map of variant → canonical RP value. */
  values: Partial<Record<Variant, number>>;
};

export const MOCK_FIXTURES: MockItem[] = [
  {
    slug: "shadow-dragon",
    name: "Shadow Dragon",
    category: "pet",
    rarity: "legendary",
    isHighTier: true,
    aliases: ["shadow", "shadow drag", "shad drag", "sd"],
    values: {
      regular: 125,
      ride: 132,
      fly: 135,
      fly_ride: 150,
      neon: 520,
      neon_ride: 560,
      neon_fly: 580,
      neon_fly_ride: 600,
      mega: 2100,
      mega_ride: 2200,
      mega_fly: 2300,
      mega_fly_ride: 2400,
    },
  },
  {
    slug: "frost-dragon",
    name: "Frost Dragon",
    category: "pet",
    rarity: "legendary",
    isHighTier: true,
    aliases: ["frost", "frost drag", "fd"],
    values: {
      regular: 70,
      ride: 78,
      fly: 82,
      fly_ride: 90,
      neon: 340,
      neon_ride: 360,
      neon_fly: 370,
      neon_fly_ride: 400,
      mega: 1300,
      mega_ride: 1380,
      mega_fly: 1420,
      mega_fly_ride: 1500,
    },
  },
  {
    slug: "owl",
    name: "Owl",
    category: "pet",
    rarity: "legendary",
    isHighTier: true,
    aliases: ["nfr owl", "owl pet"],
    values: {
      regular: 18,
      ride: 22,
      fly: 24,
      fly_ride: 30,
      neon: 90,
      neon_ride: 100,
      neon_fly: 110,
      neon_fly_ride: 130,
      mega: 480,
      mega_ride: 500,
      mega_fly: 520,
      mega_fly_ride: 600,
    },
  },
  {
    slug: "turtle",
    name: "Turtle",
    category: "pet",
    rarity: "legendary",
    isHighTier: true,
    aliases: ["mega neon turtle", "mfr turtle"],
    values: {
      regular: 16,
      ride: 20,
      fly: 22,
      fly_ride: 26,
      neon: 70,
      neon_ride: 80,
      neon_fly: 85,
      neon_fly_ride: 100,
      mega: 360,
      mega_ride: 380,
      mega_fly: 400,
      mega_fly_ride: 450,
    },
  },
  {
    slug: "cow",
    name: "Cow",
    category: "pet",
    rarity: "rare",
    aliases: ["neon cow", "moo"],
    values: {
      regular: 6,
      ride: 8,
      fly: 10,
      fly_ride: 12,
      neon: 28,
      neon_ride: 32,
      neon_fly: 34,
      neon_fly_ride: 40,
    },
  },
  {
    slug: "evil-unicorn",
    name: "Evil Unicorn",
    category: "pet",
    rarity: "legendary",
    isHighTier: true,
    aliases: ["evil uni", "eu"],
    values: {
      regular: 40,
      ride: 46,
      fly: 50,
      fly_ride: 60,
      neon: 200,
      neon_ride: 220,
      neon_fly: 230,
      neon_fly_ride: 260,
      mega: 900,
      mega_ride: 950,
      mega_fly: 980,
      mega_fly_ride: 1100,
    },
  },
  {
    slug: "ride-potion",
    name: "Ride Potion",
    category: "potion",
    rarity: "ultra-rare",
    aliases: ["ride pot"],
    values: { regular: 90 },
  },
  {
    slug: "fly-potion",
    name: "Fly Potion",
    category: "potion",
    rarity: "ultra-rare",
    aliases: ["fly pot"],
    values: { regular: 120 },
  },
  {
    slug: "diamond-ladybug",
    name: "Diamond Ladybug",
    category: "pet",
    rarity: "ultra-rare",
    isHighTier: true,
    aliases: ["dl", "ladybug"],
    values: {
      regular: 60,
      ride: 68,
      fly: 72,
      fly_ride: 80,
      neon: 280,
      neon_ride: 300,
      neon_fly: 310,
      neon_fly_ride: 340,
    },
  },
  {
    slug: "kitsune",
    name: "Kitsune",
    category: "pet",
    rarity: "legendary",
    isHighTier: true,
    aliases: ["fox", "k"],
    values: {
      regular: 150,
      ride: 160,
      fly: 165,
      fly_ride: 180,
      neon: 650,
      neon_ride: 700,
      neon_fly: 720,
      neon_fly_ride: 800,
    },
  },
];
