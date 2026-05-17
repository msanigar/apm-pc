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

  it("emits one row per pet that has a value", () => {
    // The live fixture shows 39 pets in the Pet category.
    expect(rows.length).toBeGreaterThanOrEqual(35);
    expect(rows.length).toBeLessThanOrEqual(45);
  });

  it("uses the configured source name", () => {
    for (const r of rows) expect(r.sourceName).toBe("adoptmetradingvalues");
  });

  it("parses the headline RP value for known legendaries", () => {
    const shadow = rows.find((r) => r.sourceItemName === "Shadow Dragon");
    const bat = rows.find((r) => r.sourceItemName === "Bat Dragon");
    const frost = rows.find((r) => r.sourceItemName === "Frost Dragon");
    expect(shadow?.valueRp).toBe(650);
    expect(bat?.valueRp).toBe(550);
    expect(frost?.valueRp).toBe(400);
  });

  it("treats every row as the 'regular' variant", () => {
    for (const r of rows) expect(r.variant).toBe("regular");
  });

  it("maps the row's colour class to a rarity label", () => {
    const shadow = rows.find((r) => r.sourceItemName === "Shadow Dragon");
    expect(shadow?.confidence).toBe("legendary"); // we tunnel rarity through `confidence`
    const wildBoar = rows.find((r) => r.sourceItemName === "Wild Boar");
    expect(wildBoar?.confidence).toBe("uncommon");
  });

  it("resolves root-relative image URLs against the host", () => {
    const shadow = rows.find((r) => r.sourceItemName === "Shadow Dragon");
    expect(shadow?.imageUrl).toBe(
      "https://adoptmetradingvalues.org/Adoptimage/shadow-dragon.png"
    );
  });

  it("returns an empty list on empty HTML rather than crashing", () => {
    expect(parseAmtvHtml("<html><body></body></html>", "x", "https://x")).toEqual([]);
  });
});
