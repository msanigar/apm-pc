import { describe, expect, it } from "vitest";
import type { FuseResult } from "fuse.js";
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

function hit(
  searchItem: SearchIndexItem,
  score: number,
  refIndex: number
): FuseResult<SearchIndexItem> {
  return { item: searchItem, score, refIndex };
}

describe("sortFuseHits", () => {
  it("keeps Fuse relevance when a variant is requested", () => {
    const hits = [
      hit(item("shadow-dragon", { neon: { valueRp: 900 } as any }), 0.1, 0),
      hit(item("cow", { neon: { valueRp: 50 } as any }), 0.01, 1),
      hit(item("frost-dragon", { neon: { valueRp: 800 } as any }), 0.15, 2),
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
      hit(item("cheap-neon", { neon: { valueRp: 10 } as any }), 0.05, 0),
      hit(item("expensive-neon", { neon: { valueRp: 500 } as any }), 0.05, 1),
    ];

    const sorted = sortFuseHits(hits, "neon");
    expect(sorted.map((i) => i.slug)).toEqual(["expensive-neon", "cheap-neon"]);
  });

  it("preserves Fuse hit order when no variant is requested", () => {
    const hits = [hit(item("b"), 0.2, 0), hit(item("a"), 0.1, 1)];
    expect(sortFuseHits(hits).map((i) => i.slug)).toEqual(["b", "a"]);
  });
});
