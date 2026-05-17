import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseHighTierPayload,
  parseIronbabaPayload,
} from "../githubStaticDataset";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadJson<T>(file: string): T {
  return JSON.parse(
    readFileSync(path.join(HERE, "..", "__fixtures__", file), "utf8")
  ) as T;
}

describe("parseIronbabaPayload", () => {
  const rows = parseIronbabaPayload(loadJson("github.adoptme_values.json"));

  it("emits one row per (item, variant) with a parseable value", () => {
    const shadow = rows.filter((r) => r.sourceItemName === "Shadow Dragon");
    expect(shadow.map((r) => r.variant).sort()).toEqual([
      "fly",
      "fly_ride",
      "mega",
      "mega_fly_ride",
      "neon",
      "neon_fly",
      "neon_fly_ride",
      "neon_ride",
      "regular",
      "ride",
    ]);
  });

  it("maps schema-internal variant keys to canonical Variant", () => {
    const ride = rows.find(
      (r) => r.sourceItemName === "Ride Potion" && r.variant === "regular"
    );
    expect(ride?.valueRp).toBe(88);
  });

  it("tags rows with the github source name and low confidence", () => {
    for (const r of rows) {
      expect(r.sourceName).toBe("github_ironbabatekkral");
      expect(r.confidence).toBe("low");
    }
  });

  it("drops null / dash values silently", () => {
    expect(rows.find((r) => r.sourceItemName === "Unknown Empty")).toBeUndefined();
  });

  it("accepts stringified numeric values", () => {
    const cowNfr = rows.find(
      (r) => r.sourceItemName === "Cow" && r.variant === "neon_fly_ride"
    );
    expect(cowNfr?.valueRp).toBe(42);
  });

  it("survives an object-map payload (no `items` array)", () => {
    const objMap = {
      "Shadow Dragon": {
        category: "pet",
        rarity: "legendary",
        values: { normal: 130 },
      },
    };
    const out = parseIronbabaPayload(objMap as never);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(
      expect.objectContaining({ sourceItemName: "Shadow Dragon", valueRp: 130 })
    );
  });
});

describe("parseHighTierPayload", () => {
  const rows = parseHighTierPayload(loadJson("github.high_tier_pets.json"));

  it("emits high-tier rows tagged with the correct source name", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.sourceName).toBe("github_high_tier");
      expect(r.category).toBe("pet");
      expect(r.confidence).toBe("low");
    }
  });

  it("maps known variant keys", () => {
    const kitsune = rows.find(
      (r) => r.sourceItemName === "Kitsune" && r.variant === "neon_fly_ride"
    );
    expect(kitsune?.valueRp).toBe(810);
  });
});
