import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseGizmoHtml,
  parseHighTierPayload,
  parseIronbabaPayload,
} from "../githubStaticDataset";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadFile(file: string): string {
  return readFileSync(path.join(HERE, "..", "__fixtures__", file), "utf8");
}

function loadJson<T>(file: string): T {
  return JSON.parse(loadFile(file)) as T;
}

describe("parseGizmoHtml", () => {
  const rows = parseGizmoHtml(loadFile("gizmo.values.html"));

  it("extracts a pet list from the embedded JS array", () => {
    expect(rows.length).toBeGreaterThan(50); // current snapshot has ~82
  });

  it("includes well-known high-tier pets", () => {
    const names = new Set(rows.map((r) => r.sourceItemName));
    expect(names.has("Bat Dragon")).toBe(true);
    expect(names.has("Shadow Dragon")).toBe(true);
    expect(names.has("Frost Dragon")).toBe(true);
  });

  it("parses values as positive RP numbers", () => {
    const bat = rows.find((r) => r.sourceItemName === "Bat Dragon");
    expect(bat?.valueRp).toBeGreaterThan(100);
    for (const r of rows) {
      expect(r.valueRp).toBeGreaterThan(0);
    }
  });

  it("emits only 'regular' variants — never extrapolates", () => {
    for (const r of rows) expect(r.variant).toBe("regular");
  });

  it("tags every row with the github_gizmo source and low confidence", () => {
    for (const r of rows) {
      expect(r.sourceName).toBe("github_gizmo");
      expect(r.confidence).toBe("low");
    }
  });

  it("returns an empty list when the array is missing", () => {
    expect(parseGizmoHtml("<html><body>no pets here</body></html>")).toEqual([]);
  });

  it("classifies 'Egg Stroller' as a stroller, not an egg", () => {
    // Regression: the original NON_PET_NAME_HINTS ordering matched /\begg\b/i
    // before /\bstroller\b/i so anything with "egg" in its name became an egg.
    const html = `
      <html><body><script>
        const pets = [
          { name: 'Egg Stroller', value: 5 },
          { name: 'Jungle Egg',   value: 12 },
        ];
      </script></body></html>
    `;
    const synthRows = parseGizmoHtml(html);
    const stroller = synthRows.find((r) => r.sourceItemName === "Egg Stroller");
    const egg = synthRows.find((r) => r.sourceItemName === "Jungle Egg");
    expect(stroller?.category).toBe("stroller");
    expect(egg?.category).toBe("egg");
  });
});

describe("parseIronbabaPayload", () => {
  // The ironbabatekkral repo is currently empty, but the parser stays in
  // place as a defensive fallback. We test it with a synthetic payload that
  // matches the documented shape.
  const synthetic = {
    items: [
      {
        name: "Shadow Dragon",
        category: "pet",
        rarity: "legendary",
        values: { regular: 130, neon: 540, mega: 2100, nfr: 1750 },
      },
      {
        name: "Cow",
        category: "pet",
        rarity: "ultra rare",
        values: { regular: "12", neon_fly_ride: "42" },
      },
      {
        name: "Unknown Empty",
        category: "pet",
        values: { regular: "—", neon: null },
      },
    ],
  };

  const rows = parseIronbabaPayload(synthetic);

  it("emits one row per (item, variant) with a parseable value", () => {
    const shadow = rows.filter((r) => r.sourceItemName === "Shadow Dragon");
    expect(shadow.map((r) => r.variant).sort()).toEqual([
      "mega",
      "neon",
      "neon_fly_ride",
      "regular",
    ]);
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
        category: "pet" as const,
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

  it("returns an empty list when the payload is empty or shaped wrong", () => {
    expect(parseIronbabaPayload({})).toEqual([]);
    expect(parseIronbabaPayload({ items: [] })).toEqual([]);
    expect(parseIronbabaPayload(null)).toEqual([]);
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
