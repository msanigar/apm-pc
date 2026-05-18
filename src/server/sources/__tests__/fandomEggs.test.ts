import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normaliseFilename,
  pageTitleToSlug,
  parseEggsInfobox,
  parseEggWikitext,
  parseObtainablePetsTable,
  parsePetLink,
} from "../fandomEggs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MYTHIC = readFileSync(
  path.join(HERE, "..", "__fixtures__", "fandom.mythic-egg.wikitext.txt"),
  "utf8"
);
const AZTEC = readFileSync(
  path.join(HERE, "..", "__fixtures__", "fandom.aztec-egg.wikitext.txt"),
  "utf8"
);

describe("pageTitleToSlug", () => {
  it("slugifies plain titles", () => {
    expect(pageTitleToSlug("Mythic Egg")).toBe("mythic-egg");
    expect(pageTitleToSlug("Pet Egg")).toBe("pet-egg");
  });

  it("strips parenthetical disambiguation suffixes", () => {
    expect(pageTitleToSlug("Phoenix (Pet)")).toBe("phoenix");
    expect(pageTitleToSlug("Bat Dragon (Pet)")).toBe("bat-dragon");
  });

  it("only strips a trailing parenthetical, not an inner one", () => {
    expect(pageTitleToSlug("Some (Inner) Pet")).toBe("some-inner-pet");
  });
});

describe("parsePetLink", () => {
  it("extracts plain links", () => {
    expect(parsePetLink("[[Wolpertinger]]")).toEqual({
      target: "Wolpertinger",
      display: "Wolpertinger",
    });
  });

  it("extracts piped-display links", () => {
    expect(parsePetLink("[[Phoenix (Pet)|Phoenix]]")).toEqual({
      target: "Phoenix (Pet)",
      display: "Phoenix",
    });
  });

  it("returns null when the cell has no link", () => {
    expect(parsePetLink("Common")).toBeNull();
  });
});

describe("parseEggsInfobox (Mythic Egg fixture)", () => {
  const fields = parseEggsInfobox(MYTHIC);

  it("locates the template", () => {
    expect(fields).not.toBeNull();
  });

  it("extracts every documented tier percentage", () => {
    expect(fields?.get("common")).toBe("22%");
    expect(fields?.get("uncommon")).toBe("19%");
    expect(fields?.get("rare")).toBe("34%");
    expect(fields?.get("ultra-rare")).toBe("20%");
    expect(fields?.get("legendary")).toBe("5%");
  });

  it("preserves nested template values like `{{Bucks|750}}`", () => {
    expect(fields?.get("price")).toBe("{{Bucks|750}}");
  });

  it("returns null when no `{{Eggs}}` template is present", () => {
    expect(parseEggsInfobox("== Just text ==\nNo template here.")).toBeNull();
  });
});

describe("parseObtainablePetsTable (Mythic Egg fixture)", () => {
  const rows = parseObtainablePetsTable(MYTHIC);

  it("returns one row per pet, with rowspans expanded", () => {
    // 8 pets total: Wolpertinger, Kirin, Merhorse, Sasquatch, Hydra, Wyvern,
    // Goldhorn, Phoenix.
    expect(rows).toHaveLength(8);
  });

  it("carries rarity forward across rowspan'd cells", () => {
    const petBy = (name: string) =>
      rows.find((r) => r.petCell.includes(`[[${name}`));
    expect(petBy("Merhorse")?.rarityCell).toContain("Rare");
    expect(petBy("Sasquatch")?.rarityCell).toContain("Rare");
    expect(petBy("Hydra")?.rarityCell).toContain("Ultra-Rare");
    expect(petBy("Wyvern")?.rarityCell).toContain("Ultra-Rare");
    expect(petBy("Goldhorn")?.rarityCell).toContain("Legendary");
    expect(petBy("Phoenix (Pet)")?.rarityCell).toContain("Legendary");
  });

  it("returns an empty array when no Obtainable Pets section exists", () => {
    expect(parseObtainablePetsTable("Just some text.")).toEqual([]);
  });
});

describe("parseEggWikitext (Mythic Egg fixture)", () => {
  const parsed = parseEggWikitext(MYTHIC);

  it("produces tier odds for all five rarities", () => {
    const rarities = parsed.odds.map((o) => o.rarity);
    expect(rarities).toEqual([
      "common",
      "uncommon",
      "rare",
      "ultra_rare",
      "legendary",
    ]);
  });

  it("captures the published percentages", () => {
    const by = (r: string) => parsed.odds.find((o) => o.rarity === r);
    expect(by("common")?.probabilityPct).toBe(22);
    expect(by("uncommon")?.probabilityPct).toBe(19);
    expect(by("rare")?.probabilityPct).toBe(34);
    expect(by("ultra_rare")?.probabilityPct).toBe(20);
    expect(by("legendary")?.probabilityPct).toBe(5);
  });

  it("emits one pet per row with the rarity normalised to our enum", () => {
    const names = parsed.pets.map((p) => p.petDisplay);
    expect(names).toEqual([
      "Wolpertinger",
      "Kirin",
      "Merhorse",
      "Sasquatch",
      "Hydra",
      "Wyvern",
      "Goldhorn",
      "Phoenix",
    ]);
    const wol = parsed.pets.find((p) => p.petDisplay === "Wolpertinger");
    expect(wol?.rarity).toBe("common");
    const phoenix = parsed.pets.find((p) => p.petDisplay === "Phoenix");
    expect(phoenix?.petTitle).toBe("Phoenix (Pet)");
    expect(phoenix?.rarity).toBe("legendary");
  });

  it("the percentages sum to 100 (sanity check on the fixture)", () => {
    const total = parsed.odds.reduce((s, o) => s + (o.probabilityPct ?? 0), 0);
    expect(total).toBe(100);
  });
});

describe("parseEggWikitext (4-column Aztec Egg fixture)", () => {
  // Aztec Egg uses Pet | Image | Rarity | Chance columns. Our parser must
  // identify the Rarity column from the header row, not blindly use the last
  // cell (which would land on "35%" etc.).
  const parsed = parseEggWikitext(AZTEC);

  it("captures every pet, ignoring the Chance column", () => {
    expect(parsed.pets.map((p) => p.petDisplay)).toEqual([
      "Tegu",
      "Tree Frog",
      "Chanekeh",
      "Water Opossum",
      "Ehecatl",
      "Onza",
      "Quetzalcoatl",
      "Temple Friend",
    ]);
  });

  it("uses the Rarity column for tier classification, not Chance", () => {
    const by = (name: string) =>
      parsed.pets.find((p) => p.petDisplay === name)?.rarity;
    expect(by("Tegu")).toBe("common");
    expect(by("Tree Frog")).toBe("uncommon");
    expect(by("Chanekeh")).toBe("rare");
    expect(by("Water Opossum")).toBe("rare"); // rowspan carryover
    expect(by("Ehecatl")).toBe("ultra_rare");
    expect(by("Onza")).toBe("ultra_rare"); // rowspan carryover
    expect(by("Quetzalcoatl")).toBe("legendary");
    expect(by("Temple Friend")).toBe("legendary"); // rowspan carryover
  });
});

describe("parseEggWikitext (header variations)", () => {
  it("finds the pet table even when the section header is named differently", () => {
    // Christmas Egg uses "Christmas Egg Pets" as its section header; we
    // must locate the table by inspecting its column headers, not by
    // matching the section name.
    const wikitext = `
{{Eggs|common=50%|legendary=50%}}

== Christmas Egg Pets ==
{| class="article-table"
!Pet
!Image
!Rarity
|-
|[[Robin]]
|[[File:Robin.png|center]]
|Common
|-
|[[Reindeer]]
|[[File:Reindeer.png|center]]
|Legendary
|}
    `;
    const result = parseEggWikitext(wikitext);
    expect(result.pets.map((p) => p.petDisplay)).toEqual(["Robin", "Reindeer"]);
    expect(result.pets[1].rarity).toBe("legendary");
  });

  it("ignores unrelated tables on the page", () => {
    // Some egg pages have a release-history table or update-log alongside
    // the pets table. Only the one with Pet+Rarity headers should match.
    const wikitext = `
{{Eggs|common=100%}}

{| class="article-table"
!Date
!Event
|-
|2025-01-01
|Released
|}

== Pets ==
{| class="article-table"
!Pet
!Image
!Rarity
|-
|[[Dog]]
|[[File:Dog.png|center]]
|Common
|}
    `;
    const result = parseEggWikitext(wikitext);
    expect(result.pets).toEqual([
      expect.objectContaining({ petDisplay: "Dog", rarity: "common" }),
    ]);
  });
});

describe("normaliseFilename", () => {
  it("returns null for empty / undefined", () => {
    expect(normaliseFilename(undefined)).toBeNull();
    expect(normaliseFilename(null)).toBeNull();
    expect(normaliseFilename("")).toBeNull();
    expect(normaliseFilename("   ")).toBeNull();
  });

  it("returns the bare filename for plain strings", () => {
    expect(normaliseFilename("MythicEggRender.png")).toBe("MythicEggRender.png");
    expect(normaliseFilename(" MythicEggRender.png ")).toBe("MythicEggRender.png");
  });

  it("strips a leading File:/Image: prefix", () => {
    expect(normaliseFilename("File:MythicEggRender.png")).toBe("MythicEggRender.png");
    expect(normaliseFilename("Image:MythicEggRender.png")).toBe("MythicEggRender.png");
  });

  it("unwraps [[File:...|150px]] wikilinks", () => {
    expect(normaliseFilename("[[File:Mythic Egg.png|150px]]")).toBe("Mythic Egg.png");
    expect(normaliseFilename("[[Image:Aztec Egg.png|center|frame]]")).toBe(
      "Aztec Egg.png"
    );
  });

  it("strips trailing display params on bare strings", () => {
    expect(normaliseFilename("Egg.png|150px")).toBe("Egg.png");
  });
});

describe("parseEggWikitext (image extraction)", () => {
  it("returns the bare image filename from the {{Eggs}} template", () => {
    const result = parseEggWikitext(MYTHIC);
    expect(result.imageFilename).toBe("MythicEggRender.png");
  });

  it("returns null when no image field is present", () => {
    const result = parseEggWikitext("{{Eggs|common=50%|legendary=50%}}");
    expect(result.imageFilename).toBeNull();
  });
});

describe("parseEggWikitext (edge cases)", () => {
  it("handles a missing Obtainable Pets section gracefully", () => {
    const result = parseEggWikitext(
      "{{Eggs|common=50%|legendary=50%}}\n\nNo pets here."
    );
    expect(result.odds).toHaveLength(2);
    expect(result.pets).toEqual([]);
  });

  it("handles a missing {{Eggs}} template gracefully", () => {
    const minimal = `
== Obtainable Pets ==
{| class="article-table"
|-
!Pet!!Rarity
|-
|[[Cat]]
|Common
|}
    `;
    const result = parseEggWikitext(minimal);
    expect(result.odds).toEqual([]);
    expect(result.pets[0]).toEqual(
      expect.objectContaining({ petTitle: "Cat", rarity: "common" })
    );
  });

  it("recognises percentages provided without the `%` symbol", () => {
    const result = parseEggWikitext("{{Eggs|common=50|legendary=10}}");
    expect(result.odds[0].probabilityPct).toBe(50);
    expect(result.odds[1].probabilityPct).toBe(10);
  });

  it("returns null probability for unknown tier values", () => {
    const result = parseEggWikitext("{{Eggs|common=N/A|legendary=}}");
    const common = result.odds.find((o) => o.rarity === "common");
    expect(common?.probabilityPct).toBeNull();
  });
});
