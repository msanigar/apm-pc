import { describe, expect, it } from "vitest";
import type { SearchIndexItem } from "@shared/types";
import { sortFuseHits } from "../searchRank";

function item(
  slug: string,
  values: Partial<SearchIndexItem["values"]> = {}
): SearchIndexItem {
  return {
    id: slug,
    slug,
    name: slug,
    category: "pet",
    aliases: [],
    isHighTier: false,
    values,
  };
}

describe("sortFuseHits", () => {
  it("keeps Fuse relevance when a variant is requested", () => {
    const hits = [
      { item: item("shadow-dragon", { neon: { valueRp: 900 } as any }), score: 0.1 },
      { item: item("cow", { neon: { valueRp: 50 } as any }), score: 0.01 },
      { item: item("frost-dragon", { neon: { valueRp: 800 } as any }), score: 0.15 },
    ];

    const sorted = sortFuseHits(hits, "neon");
    expect(sorted.map((i) => i.slug)).toEqual([
      "cow",
      "shadow-dragon",
      "frost-dragon",
    ]);
  });

  it("uses variant value only as a tie-breaker for equal Fuse scores", () => {
    const hits = [
      { item: item("cheap-neon", { neon: { valueRp: 10 } as any }), score: 0.05 },
      { item: item("expensive-neon", { neon: { valueRp: 500 } as any }), score: 0.05 },
    ];

    const sorted = sortFuseHits(hits, "neon");
    expect(sorted.map((i) => i.slug)).toEqual(["expensive-neon", "cheap-neon"]);
  });

  it("preserves Fuse hit order when no variant is requested", () => {
    const hits = [
      { item: item("b"), score: 0.2 },
      { item: item("a"), score: 0.1 },
    ];
    expect(sortFuseHits(hits).map((i) => i.slug)).toEqual(["b", "a"]);
  });
});
