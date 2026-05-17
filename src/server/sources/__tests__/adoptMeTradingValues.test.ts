import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAmtvHtml } from "../adoptMeTradingValues";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  path.join(HERE, "..", "__fixtures__", "amtv.values.html"),
  "utf8"
);

describe("parseAmtvHtml", () => {
  const rows = parseAmtvHtml(
    FIXTURE,
    "adoptmetradingvalues",
    "https://adoptmetradingvalues.org"
  );

  it("emits one row per item with a value", () => {
    const names = rows.map((r) => r.sourceItemName).sort();
    expect(names).toEqual(["Frost Dragon", "Ride Potion", "Shadow Dragon"]);
  });

  it("uses the configured source name", () => {
    for (const r of rows) expect(r.sourceName).toBe("adoptmetradingvalues");
  });

  it("parses values as RP numbers", () => {
    expect(
      rows.find((r) => r.sourceItemName === "Shadow Dragon")?.valueRp
    ).toBe(140);
    expect(
      rows.find((r) => r.sourceItemName === "Frost Dragon")?.valueRp
    ).toBe(75);
  });

  it("ignores rows whose value is missing", () => {
    expect(rows.find((r) => r.sourceItemName === "Kitsune")).toBeUndefined();
  });

  it("resolves root-relative, absolute, and protocol-relative image URLs", () => {
    expect(rows.find((r) => r.sourceItemName === "Shadow Dragon")?.imageUrl).toBe(
      "https://adoptmetradingvalues.org/images/items/shadow-dragon.png"
    );
    expect(rows.find((r) => r.sourceItemName === "Frost Dragon")?.imageUrl).toBe(
      "https://cdn.example.com/items/frost-dragon.png"
    );
    expect(rows.find((r) => r.sourceItemName === "Ride Potion")?.imageUrl).toBe(
      "https://cdn.example.com/items/ride-potion.png"
    );
  });

  it("maps categories using the lookup table", () => {
    expect(
      rows.find((r) => r.sourceItemName === "Ride Potion")?.category
    ).toBe("potion");
    expect(
      rows.find((r) => r.sourceItemName === "Shadow Dragon")?.category
    ).toBe("pet");
  });

  it("returns an empty list on empty HTML rather than crashing", () => {
    expect(
      parseAmtvHtml("<html><body></body></html>", "x", "https://x")
    ).toEqual([]);
  });
});
