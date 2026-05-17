import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "../parseSearchQuery";

describe("parseSearchQuery", () => {
  it("returns empty results for an empty query", () => {
    const result = parseSearchQuery("");
    expect(result.normalizedQuery).toBe("");
    expect(result.requestedVariant).toBeUndefined();
  });

  it("normalises whitespace and case", () => {
    const result = parseSearchQuery("  ShAdOw   DrAgOn  ");
    expect(result.normalizedQuery).toBe("shadow dragon");
    expect(result.requestedVariant).toBeUndefined();
  });

  it("parses FR <item> abbreviation", () => {
    const result = parseSearchQuery("FR Shadow Dragon");
    expect(result.normalizedQuery).toBe("shadow dragon");
    expect(result.requestedVariant).toBe("fly_ride");
  });

  it("parses NFR <item> abbreviation", () => {
    const result = parseSearchQuery("NFR Frost");
    expect(result.normalizedQuery).toBe("frost");
    expect(result.requestedVariant).toBe("neon_fly_ride");
  });

  it("parses MFR <item> abbreviation", () => {
    const result = parseSearchQuery("MFR Owl");
    expect(result.normalizedQuery).toBe("owl");
    expect(result.requestedVariant).toBe("mega_fly_ride");
  });

  it("parses spelled-out 'Mega Ride <item>'", () => {
    const result = parseSearchQuery("Mega Ride Turtle");
    expect(result.normalizedQuery).toBe("turtle");
    expect(result.requestedVariant).toBe("mega_ride");
  });

  it("parses spelled-out 'Fly Ride <item>'", () => {
    const result = parseSearchQuery("Fly Ride Frost Dragon");
    expect(result.normalizedQuery).toBe("frost dragon");
    expect(result.requestedVariant).toBe("fly_ride");
  });

  it("parses spelled-out 'Neon <item>'", () => {
    const result = parseSearchQuery("neon cow");
    expect(result.normalizedQuery).toBe("cow");
    expect(result.requestedVariant).toBe("neon");
  });

  it("parses 'Mega Neon Turtle' as mega variant", () => {
    const result = parseSearchQuery("Mega Neon Turtle");
    expect(result.normalizedQuery).toBe("turtle");
    expect(result.requestedVariant).toBe("mega");
  });

  it("does not treat 'Ride Potion' as a variant", () => {
    const result = parseSearchQuery("Ride Potion");
    expect(result.normalizedQuery).toBe("ride potion");
    expect(result.requestedVariant).toBeUndefined();
  });

  it("does not treat 'Fly Potion' as a variant", () => {
    const result = parseSearchQuery("Fly Potion");
    expect(result.normalizedQuery).toBe("fly potion");
    expect(result.requestedVariant).toBeUndefined();
  });

  it("does not treat 'Neon Potion' as a variant", () => {
    const result = parseSearchQuery("Neon Potion");
    expect(result.normalizedQuery).toBe("neon potion");
    expect(result.requestedVariant).toBeUndefined();
  });

  it("returns the abbreviation alone untouched if there's no item after it", () => {
    const result = parseSearchQuery("fr");
    expect(result.normalizedQuery).toBe("fr");
    expect(result.requestedVariant).toBeUndefined();
  });

  it("parses short prefixes followed by item name", () => {
    expect(parseSearchQuery("nf cow").requestedVariant).toBe("neon_fly");
    expect(parseSearchQuery("nr cow").requestedVariant).toBe("neon_ride");
    expect(parseSearchQuery("mr cow").requestedVariant).toBe("mega_ride");
    expect(parseSearchQuery("mf cow").requestedVariant).toBe("mega_fly");
    expect(parseSearchQuery("r cow").requestedVariant).toBe("ride");
    expect(parseSearchQuery("f cow").requestedVariant).toBe("fly");
    expect(parseSearchQuery("n cow").requestedVariant).toBe("neon");
    expect(parseSearchQuery("m cow").requestedVariant).toBe("mega");
  });

  it("preserves the item name for shadow dragon search without variant", () => {
    expect(parseSearchQuery("shadow drag").normalizedQuery).toBe("shadow drag");
    expect(parseSearchQuery("shadow drag").requestedVariant).toBeUndefined();
  });
});
