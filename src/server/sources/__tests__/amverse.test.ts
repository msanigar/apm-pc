import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAmverseHtml } from "../amverse";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  path.join(HERE, "..", "__fixtures__", "amverse.values.html"),
  "utf8"
);

describe("parseAmverseHtml", () => {
  const rows = parseAmverseHtml(FIXTURE);

  it("emits rows under both internal source names", () => {
    const names = new Set(rows.map((r) => r.sourceName));
    expect(names).toEqual(new Set(["amverse_elvebredd", "amverse_amvgg"]));
  });

  it("parses Shadow Dragon Regular/Neon/Mega for both sources", () => {
    const elveShadow = rows.filter(
      (r) =>
        r.sourceName === "amverse_elvebredd" && r.sourceItemName === "Shadow Dragon"
    );
    const amvShadow = rows.filter(
      (r) =>
        r.sourceName === "amverse_amvgg" && r.sourceItemName === "Shadow Dragon"
    );

    expect(elveShadow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variant: "regular", valueRp: 125 }),
        expect.objectContaining({ variant: "neon", valueRp: 520 }),
        expect.objectContaining({ variant: "mega", valueRp: 2_100 }),
      ])
    );
    expect(amvShadow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variant: "regular", valueRp: 130 }),
        expect.objectContaining({ variant: "neon", valueRp: 540 }),
        expect.objectContaining({ variant: "mega", valueRp: 2_200 }), // 2.2k
      ])
    );
  });

  it("ignores missing values rather than emitting zeros", () => {
    const frost = rows.filter((r) => r.sourceItemName === "Frost Dragon");
    // Elvebredd reports — for Mega; AMVGG reports N/A for Neon. Neither
    // should appear in the output. Each source should emit only its
    // populated variants.
    expect(
      frost
        .filter((r) => r.sourceName === "amverse_elvebredd")
        .map((r) => r.variant)
        .sort()
    ).toEqual(["neon", "regular"]);
    expect(
      frost
        .filter((r) => r.sourceName === "amverse_amvgg")
        .map((r) => r.variant)
        .sort()
    ).toEqual(["mega", "regular"]);
  });

  it("respects the per-item data-category attribute", () => {
    const potion = rows.find((r) => r.sourceItemName === "Ride Potion");
    expect(potion?.category).toBe("potion");
    const shadow = rows.find((r) => r.sourceItemName === "Shadow Dragon");
    expect(shadow?.category).toBe("pet");
  });

  it("returns an empty list on empty HTML rather than crashing", () => {
    expect(parseAmverseHtml("<html><body></body></html>")).toEqual([]);
  });

  it("returns an empty list when the table is malformed", () => {
    expect(parseAmverseHtml("<html><body><article class=item-card></article></body></html>"))
      .toEqual([]);
  });
});
