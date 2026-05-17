import { describe, expect, it, vi } from "vitest";
import {
  normalizeSourceValue,
  parseRpValue,
  resolveImageUrl,
  safeAdapter,
} from "../lib";

describe("parseRpValue", () => {
  it("accepts plain numbers", () => {
    expect(parseRpValue(125)).toBe(125);
    expect(parseRpValue("125")).toBe(125);
    expect(parseRpValue("12.5")).toBe(12.5);
  });

  it("handles k/m suffixes case-insensitively", () => {
    expect(parseRpValue("1.5k")).toBe(1_500);
    expect(parseRpValue("2K")).toBe(2_000);
    expect(parseRpValue("1.2m")).toBe(1_200_000);
  });

  it("strips comma thousands separators", () => {
    expect(parseRpValue("1,250")).toBe(1_250);
    expect(parseRpValue("12,345 RP")).toBe(12_345);
  });

  it("returns null for missing-value markers", () => {
    for (const v of ["", "—", "–", "-", "N/A", "n/a", "TBD", "?", "??", "none"]) {
      expect(parseRpValue(v), `expected ${JSON.stringify(v)} → null`).toBeNull();
    }
  });

  it("returns null for zero or negative numbers", () => {
    expect(parseRpValue(0)).toBeNull();
    expect(parseRpValue(-5)).toBeNull();
    expect(parseRpValue("0")).toBeNull();
  });

  it("returns null for nonsense", () => {
    expect(parseRpValue(null)).toBeNull();
    expect(parseRpValue(undefined)).toBeNull();
    expect(parseRpValue({})).toBeNull();
    expect(parseRpValue("not a number")).toBeNull();
  });
});

describe("resolveImageUrl", () => {
  it("returns absolute URLs unchanged", () => {
    expect(resolveImageUrl("https://x.com/a.png", "https://base")).toBe(
      "https://x.com/a.png"
    );
  });
  it("prefixes protocol-relative URLs with https", () => {
    expect(resolveImageUrl("//cdn.x.com/a.png", "https://base")).toBe(
      "https://cdn.x.com/a.png"
    );
  });
  it("joins root-relative paths to baseHost", () => {
    expect(resolveImageUrl("/img/a.png", "https://base.example.com/")).toBe(
      "https://base.example.com/img/a.png"
    );
  });
  it("ignores data: URLs", () => {
    expect(resolveImageUrl("data:image/png;base64,xxx", "https://base")).toBeUndefined();
  });
  it("returns undefined for blank input", () => {
    expect(resolveImageUrl("", "https://base")).toBeUndefined();
    expect(resolveImageUrl(null, "https://base")).toBeUndefined();
  });
});

describe("normalizeSourceValue", () => {
  it("produces a RawSourceValue when value is parseable", () => {
    const v = normalizeSourceValue({
      sourceName: "s",
      sourceItemName: " Shadow Dragon ",
      rawValue: "1.5k",
      category: "pet",
      variant: "neon_fly_ride",
      imageUrl: "https://x/a.png",
    });
    expect(v).toEqual({
      sourceName: "s",
      sourceItemName: "Shadow Dragon",
      category: "pet",
      variant: "neon_fly_ride",
      valueRp: 1_500,
      imageUrl: "https://x/a.png",
      confidence: undefined,
    });
  });

  it("returns null for missing name", () => {
    expect(
      normalizeSourceValue({ sourceName: "s", sourceItemName: "", rawValue: 10 })
    ).toBeNull();
  });

  it("returns null for missing value", () => {
    expect(
      normalizeSourceValue({ sourceName: "s", sourceItemName: "X", rawValue: "—" })
    ).toBeNull();
  });
});

describe("safeAdapter", () => {
  it("returns an empty array when the fetcher throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const adapter = safeAdapter({
      name: "x",
      description: "test",
      fetchValues: async () => {
        throw new Error("boom");
      },
    });
    const result = await adapter.fetchValues();
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("short-circuits when enabled=false", async () => {
    let called = 0;
    const adapter = safeAdapter({
      name: "x",
      description: "test",
      enabled: false,
      fetchValues: async () => {
        called++;
        return [];
      },
    });
    expect(await adapter.fetchValues()).toEqual([]);
    expect(called).toBe(0);
  });

  it("filters null entries out of fetcher result", async () => {
    const adapter = safeAdapter({
      name: "x",
      description: "test",
      fetchValues: async () =>
        [
          { sourceName: "x", sourceItemName: "A", valueRp: 1 },
          null as never,
          { sourceName: "x", sourceItemName: "B", valueRp: 2 },
        ].filter((v): v is NonNullable<typeof v> => v != null || true),
    });
    const result = await adapter.fetchValues();
    expect(result).toHaveLength(2);
  });
});
