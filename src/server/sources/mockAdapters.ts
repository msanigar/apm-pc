import type { RawSourceValue } from "../../shared/normalize";
import type { Variant } from "../../shared/types";
import { MOCK_FIXTURES, type MockItem } from "./mockFixtures";
import type { SourceAdapter } from "./types";

/**
 * Build a `RawSourceValue[]` from the canonical fixtures, applying a
 * deterministic per-source multiplier so the three mocks disagree slightly.
 * This is exactly the kind of disagreement the median aggregator is built to
 * handle.
 */
function buildSourceValues(
  sourceName: string,
  skew: number
): RawSourceValue[] {
  const out: RawSourceValue[] = [];
  for (const item of MOCK_FIXTURES) {
    for (const [variant, value] of Object.entries(item.values) as Array<
      [Variant, number]
    >) {
      out.push({
        sourceName,
        sourceItemName: makeSourceName(item, variant, sourceName),
        category: item.category,
        variant,
        valueRp: roundQuarter(value * skew),
        imageUrl: item.imageUrl,
      });
    }
  }
  return out;
}

/**
 * Each adapter emits its names in a slightly different style so we exercise
 * normalisation. For example:
 *   - mock-a uses canonical names + explicit variants.
 *   - mock-b prefixes the variant onto the name ("FR Shadow Dragon").
 *   - mock-c uses an alias instead of the canonical name when one exists.
 */
function makeSourceName(item: MockItem, variant: Variant, source: string): string {
  if (source === "mock-b") {
    return `${shortVariant(variant)} ${item.name}`.trim();
  }
  if (source === "mock-c" && item.aliases && item.aliases.length > 0) {
    return `${shortVariant(variant)} ${item.aliases[0]}`.trim();
  }
  return item.name;
}

function shortVariant(v: Variant): string {
  switch (v) {
    case "regular":
      return "";
    case "ride":
      return "R";
    case "fly":
      return "F";
    case "fly_ride":
      return "FR";
    case "neon":
      return "N";
    case "neon_ride":
      return "NR";
    case "neon_fly":
      return "NF";
    case "neon_fly_ride":
      return "NFR";
    case "mega":
      return "M";
    case "mega_ride":
      return "MR";
    case "mega_fly":
      return "MF";
    case "mega_fly_ride":
      return "MFR";
  }
}

function roundQuarter(n: number): number {
  return Math.round(n * 4) / 4;
}

export const mockSourceAAdapter: SourceAdapter = {
  name: "mock-a",
  description: "Mock source A — canonical names with explicit variants",
  fetchValues: async () => buildSourceValues("mock-a", 1.0),
};

export const mockSourceBAdapter: SourceAdapter = {
  name: "mock-b",
  description: "Mock source B — variant prefixes in names, slight underbid",
  fetchValues: async () => buildSourceValues("mock-b", 0.95),
};

export const mockSourceCAdapter: SourceAdapter = {
  name: "mock-c",
  description: "Mock source C — uses aliases, slight overbid",
  fetchValues: async () => buildSourceValues("mock-c", 1.05),
};

export const ALL_MOCK_ADAPTERS: SourceAdapter[] = [
  mockSourceAAdapter,
  mockSourceBAdapter,
  mockSourceCAdapter,
];
