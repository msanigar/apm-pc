import { describe, expect, it } from "vitest";
import {
  buildAliasMap,
  buildCandidateDataset,
  normalizeSourceValues,
} from "../normalize";

describe("normalizeSourceValues", () => {
  it("lifts a variant prefix out of the source item name", () => {
    const result = normalizeSourceValues([
      {
        sourceName: "mock-a",
        sourceItemName: "FR Shadow Dragon",
        valueRp: 150,
      },
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        itemSlug: "shadow-dragon",
        itemName: "Shadow Dragon",
        variant: "fly_ride",
        valueRp: 150,
        category: "pet",
      }),
    ]);
  });

  it("respects an explicit variant from the source", () => {
    const result = normalizeSourceValues([
      {
        sourceName: "mock-b",
        sourceItemName: "Shadow Dragon",
        variant: "neon_fly_ride",
        valueRp: 600,
      },
    ]);
    expect(result[0].variant).toBe("neon_fly_ride");
    expect(result[0].itemSlug).toBe("shadow-dragon");
  });

  it("drops zero or negative values", () => {
    const result = normalizeSourceValues([
      { sourceName: "x", sourceItemName: "Dog", valueRp: 0 },
      { sourceName: "x", sourceItemName: "Cat", valueRp: -5 },
      { sourceName: "x", sourceItemName: "Owl", valueRp: 10 },
    ]);
    expect(result.map((r) => r.itemSlug)).toEqual(["owl"]);
  });

  it("treats 'Ride Potion' as an item, not a variant", () => {
    const result = normalizeSourceValues([
      { sourceName: "x", sourceItemName: "Ride Potion", valueRp: 50 },
    ]);
    expect(result[0].itemSlug).toBe("ride-potion");
    expect(result[0].variant).toBe("regular");
  });

  it("canonicalises via the alias map", () => {
    const aliases = buildAliasMap([
      { slug: "shadow-dragon", name: "Shadow Dragon", aliases: ["shadow", "sd"] },
    ]);
    const result = normalizeSourceValues(
      [
        { sourceName: "a", sourceItemName: "Shadow Dragon", valueRp: 100 },
        { sourceName: "b", sourceItemName: "Shadow", valueRp: 105 },
        { sourceName: "c", sourceItemName: "FR sd", valueRp: 150 },
      ],
      aliases
    );
    expect(result.every((r) => r.itemSlug === "shadow-dragon")).toBe(true);
    expect(result.find((r) => r.sourceName === "c")?.variant).toBe("fly_ride");
  });
});

describe("buildCandidateDataset", () => {
  it("groups values by (itemSlug, variant) across sources", () => {
    const ds = buildCandidateDataset([
      {
        sourceName: "a",
        sourceItemName: "FR Shadow Dragon",
        itemSlug: "shadow-dragon",
        itemName: "Shadow Dragon",
        category: "pet",
        variant: "fly_ride",
        valueRp: 145,
      },
      {
        sourceName: "b",
        sourceItemName: "FR Shadow Dragon",
        itemSlug: "shadow-dragon",
        itemName: "Shadow Dragon",
        category: "pet",
        variant: "fly_ride",
        valueRp: 150,
      },
      {
        sourceName: "a",
        sourceItemName: "Shadow Dragon",
        itemSlug: "shadow-dragon",
        itemName: "Shadow Dragon",
        category: "pet",
        variant: "regular",
        valueRp: 100,
      },
    ]);
    expect(ds.sourceNames.sort()).toEqual(["a", "b"]);
    expect(ds.rows).toHaveLength(2);
    const fr = ds.rows.find((r) => r.variant === "fly_ride");
    expect(fr?.values.sort((a, b) => a - b)).toEqual([145, 150]);
    expect(fr?.sources.sort()).toEqual(["a", "b"]);
  });

  it("deduplicates a source contributing twice to the same key", () => {
    const ds = buildCandidateDataset([
      {
        sourceName: "a",
        sourceItemName: "Dog",
        itemSlug: "dog",
        itemName: "Dog",
        category: "pet",
        variant: "regular",
        valueRp: 100,
      },
      {
        sourceName: "a",
        sourceItemName: "Dog",
        itemSlug: "dog",
        itemName: "Dog",
        category: "pet",
        variant: "regular",
        valueRp: 999,
      },
    ]);
    expect(ds.rows).toHaveLength(1);
    expect(ds.rows[0].values).toEqual([100]);
    expect(ds.rows[0].sources).toEqual(["a"]);
  });
});
