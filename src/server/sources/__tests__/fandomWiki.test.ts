import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normaliseFilename,
  pageTitleToSlug,
  parseEggsInfobox,
  parseEggWikitext,
  parseObtainableItemsTable,
  parseObtainablePetsTable,
  parsePetAcquisitionFromWikitext,
  parsePetLink,
} from "../fandomWiki";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
  return readFileSync(
    path.join(HERE, "..", "__fixtures__", `fandom.${name}.wikitext.txt`),
    "utf8"
  );
}

const MYTHIC = fixture("mythic-egg");
const AZTEC = fixture("aztec-egg");
const CERBERUS = fixture("cerberus");
const BAT_DRAGON = fixture("bat-dragon");
const FROST_DRAGON = fixture("frost-dragon");
const ROBIN = fixture("robin");
const SASQUATCH = fixture("sasquatch");
const RGB_REWARD_BOX = fixture("rgb-reward-box");

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

describe("parseObtainableItemsTable (gift / reward-box content)", () => {
  it("parses RGB Reward Box contents with the Item|Image|Rarity|Category|Chance shape", () => {
    const rows = parseObtainableItemsTable(RGB_REWARD_BOX);
    expect(rows.length).toBeGreaterThanOrEqual(5);

    const collar = rows.find((r) => r.itemCell.includes("RGB Collar"));
    expect(collar).toBeDefined();
    expect(collar?.rarityCell.toLowerCase()).toBe("common");
    // The Category column is a wiki link to "Category:Pet Accessories" with
    // display "Pet Accessory". `categoryCell` is the raw cell text, so
    // existence and link presence is what we assert here; downstream code
    // strips the link.
    expect(collar?.categoryCell).toMatch(/Pet Accessor/i);
  });

  it("returns nothing for pages without an obtainable-items table", () => {
    const minimal =
      "{{Eggs|common=50%|legendary=50%}}\n\nThe Pizza Box is a snack.";
    expect(parseObtainableItemsTable(minimal)).toEqual([]);
  });
});

describe("parsePetAcquisitionFromWikitext (lede prose extraction)", () => {
  it("extracts a Robux purchase + event + retired flag (Cerberus)", () => {
    const result = parsePetAcquisitionFromWikitext(CERBERUS);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("robux");
    expect(result?.currency).toBe("robux");
    expect(result?.cost).toBe(500);
    expect(result?.eventName).toBe("Halloween Event");
    expect(result?.eventYear).toBe(2020);
    expect(result?.releasedAt).toBe("2020-10-28");
    expect(result?.retired).toBe(true);
  });

  it("extracts a Candy purchase + event + retired flag (Bat Dragon)", () => {
    const result = parsePetAcquisitionFromWikitext(BAT_DRAGON);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("paid");
    expect(result?.currency).toBe("candy");
    expect(result?.cost).toBe(180000);
    expect(result?.eventName).toBe("Halloween Event");
    expect(result?.eventYear).toBe(2019);
    expect(result?.retired).toBe(true);
  });

  it("extracts a Robux purchase + retired flag, even without an explicit event link (Frost Dragon)", () => {
    const result = parsePetAcquisitionFromWikitext(FROST_DRAGON);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("robux");
    expect(result?.currency).toBe("robux");
    expect(result?.cost).toBe(1000);
    expect(result?.retired).toBe(true);
    expect(result?.releasedAt).toBe("2019-12-20");
  });

  it("extracts an event acquisition for egg-hatched event pets (Robin from Christmas)", () => {
    const result = parsePetAcquisitionFromWikitext(ROBIN);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("event");
    expect(result?.eventName).toBe("Christmas Event");
    expect(result?.eventYear).toBe(2019);
    expect(result?.retired).toBe(true);
    expect(result?.releasedAt).toBe("2019-12-14");
    // Robin's only currency reference (`{{Gingerbread|1,440}}`) lives
    // inside the {{Pets}} infobox and refers to the Christmas Egg, not
    // the pet — our parser intentionally strips the infobox before
    // looking for prose-level currency templates.
    expect(result?.currency).toBeNull();
  });

  it("skips egg-hatch-only pages with no extra event/Robux signal", () => {
    // Construct a minimal lede that ONLY mentions egg hatching, no event,
    // no currency, no "limited"/"retired" wording.
    const eggOnly = `
The '''Cat''' is a [[Pets|pet]] in ''Adopt Me!''. It can be obtained by hatching a [[Cracked Egg]].
    `;
    expect(parsePetAcquisitionFromWikitext(eggOnly)).toBeNull();
  });

  it("returns null when the page has no usable acquisition signal at all", () => {
    expect(parsePetAcquisitionFromWikitext("")).toBeNull();
    expect(
      parsePetAcquisitionFromWikitext(
        "Just some plain prose about a pet's appearance."
      )
    ).toBeNull();
  });

  it("returns a non-null result with a Bucks cost for Sasquatch (Mythic Egg event pet)", () => {
    const result = parsePetAcquisitionFromWikitext(SASQUATCH);
    // Sasquatch lede: hatches from Mythic Egg, retired, etc. — it should
    // return an acquisition row because of the "limited" + retirement
    // language, even though the primary acquisition is egg-hatching.
    expect(result).not.toBeNull();
    expect(result?.retired).toBe(true);
  });
});
