import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAmversePage } from "../amverse";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(
    path.join(HERE, "..", "__fixtures__", "amverse.api.json"),
    "utf8"
  )
) as { pets: unknown[] };

describe("parseAmversePage", () => {
  const rows = parseAmversePage(FIXTURE as any);

  it("emits rows under the Elvebredd source (we drop AMVGG)", () => {
    const names = new Set(rows.map((r) => r.sourceName));
    expect(names).toEqual(new Set(["amverse_elvebredd"]));
  });

  it("parses every published variant for a high-tier legendary (Bat Dragon)", () => {
    const bat = rows.filter((r) => r.sourceItemName === "Bat Dragon");
    const variants = new Set(bat.map((r) => r.variant));
    expect(variants).toEqual(
      new Set([
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
      ])
    );

    const byVariant = Object.fromEntries(
      bat.map((r) => [r.variant, r.valueRp])
    );
    expect(byVariant.regular).toBeGreaterThan(500);
    expect(byVariant.mega_fly_ride).toBeGreaterThan(byVariant.neon_fly_ride!);
    expect(byVariant.neon).toBeGreaterThan(byVariant.regular!);
  });

  it("includes mid-tier and low-tier items in the catalog (Ant, Chicken)", () => {
    const ant = rows.find(
      (r) => r.sourceItemName === "Ant" && r.variant === "regular"
    );
    const chicken = rows.find(
      (r) => r.sourceItemName === "Chicken" && r.variant === "regular"
    );
    expect(ant).toBeDefined();
    expect(chicken).toBeDefined();
    expect(ant?.valueRp).toBeGreaterThan(0);
    expect(chicken?.valueRp).toBeGreaterThan(0);
  });

  it("skips variants the source publishes as null", () => {
    // 1000 Bucks Silk Bag only has elve.rvalue set; neon/mega/etc. are null
    // or absent. We should emit exactly one row (regular).
    const silk = rows.filter((r) => r.sourceItemName === "1000 Bucks Silk Bag");
    expect(silk.map((r) => r.variant).sort()).toEqual(["regular"]);
  });

  it("classifies items into the right category from name heuristics", () => {
    const dog = rows.find(
      (r) => r.sourceItemName === "Dog" && r.variant === "regular"
    );
    expect(dog?.category).toBe("pet");
  });

  it("classifies 'Egg Stroller' as a stroller, not an egg", () => {
    // Regression: the original substring check matched "egg" first and ate
    // every stroller-with-egg-in-the-name. We need stroller to win.
    const synthetic = [
      {
        petId: "test-egg-stroller",
        name: "Egg Stroller",
        rarity: "rare",
        imageUrl: null,
        elve: { rvalue: 5 },
      },
    ];
    const synthRows = parseAmversePage(synthetic as never);
    expect(synthRows[0]?.category).toBe("stroller");
  });

  it("classifies plain eggs as 'egg'", () => {
    const synthetic = [
      {
        petId: "test-jungle-egg",
        name: "Jungle Egg",
        rarity: "rare",
        imageUrl: null,
        elve: { rvalue: 12 },
      },
    ];
    const synthRows = parseAmversePage(synthetic as never);
    expect(synthRows[0]?.category).toBe("egg");
  });

  it("passes through image URLs for the cache layer", () => {
    const shadow = rows.find((r) => r.sourceItemName === "Shadow Dragon");
    expect(shadow?.imageUrl).toMatch(/^https?:\/\/.+\.(png|webp|jpg|jpeg)$/i);
  });

  it("returns an empty list on an empty page rather than crashing", () => {
    expect(parseAmversePage({ pets: [], total: 0, offset: 0, limit: 0 })).toEqual([]);
    expect(parseAmversePage([])).toEqual([]);
  });
});
