import { describe, expect, it } from "vitest";
import pokemon from "../test-fixtures/pokemon-25.json";
import species from "../test-fixtures/species-25.json";
import {
  cleanFlavorText,
  idFromResourceUrl,
  parseSpeciesList,
  toDexEntry,
} from "./pokeapi";

describe("parseSpeciesList", () => {
  it("reads ids from resource urls and sorts by national number", () => {
    expect(
      parseSpeciesList({
        count: 3,
        results: [
          { name: "ivysaur", url: "https://pokeapi.co/api/v2/pokemon-species/2/" },
          { name: "bulbasaur", url: "https://pokeapi.co/api/v2/pokemon-species/1/" },
          { name: "broken", url: "https://pokeapi.co/api/v2/pokemon-species/" },
        ],
      }),
    ).toEqual([
      { id: 1, slug: "bulbasaur" },
      { id: 2, slug: "ivysaur" },
    ]);
  });

  it("rejects a payload without results", () => {
    expect(() => parseSpeciesList({ count: 0 })).toThrow();
  });
});

describe("idFromResourceUrl", () => {
  it("accepts urls with or without a trailing slash", () => {
    expect(idFromResourceUrl("https://pokeapi.co/api/v2/pokemon/1025/")).toBe(1025);
    expect(idFromResourceUrl("https://pokeapi.co/api/v2/pokemon/7")).toBe(7);
    expect(idFromResourceUrl("https://pokeapi.co/api/v2/pokemon/0/")).toBeNull();
  });
});

describe("cleanFlavorText", () => {
  it("joins game line breaks, form feeds, and soft hyphens", () => {
    expect(
      cleanFlavorText("When several of\nthese POKéMON\ngather, their\felectri\u00ad\ncity could"),
    ).toBe("When several of these Pokémon gather, their electricity could");
    expect(cleanFlavorText("This clever\nforest-\ndweller")).toBe("This clever forest-dweller");
  });
});

describe("toDexEntry", () => {
  it("builds an entry from PokeAPI species and pokemon payloads", () => {
    const entry = toDexEntry(species, pokemon);
    expect(entry).toMatchObject({
      id: 25,
      slug: "pikachu",
      name: "Pikachu",
      genus: "Mouse Pokémon",
      flavorVersion: "legends-arceus",
      types: ["electric"],
      heightDm: 4,
      weightHg: 60,
      abilities: [
        { slug: "static", hidden: false },
        { slug: "lightning-rod", hidden: true },
      ],
      generation: "generation-i",
      habitat: "forest",
      captureRate: 190,
      isLegendary: false,
      isMythical: false,
      spriteUrl: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png",
      cryUrl: "https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/25.ogg",
    });
    expect(entry.flavorText).toMatch(/^Possesses cheek sacs/);
    expect(entry.flavorText).not.toContain("\n");
    expect(entry.stats.map((stat) => stat.slug)).toEqual([
      "hp",
      "attack",
      "defense",
      "special-attack",
      "special-defense",
      "speed",
    ]);
  });

  it("tolerates species with no habitat, genus, or flavor text", () => {
    const entry = toDexEntry(
      { ...species, habitat: null, genera: [], flavor_text_entries: [] },
      { ...pokemon, cries: { latest: null, legacy: null } },
    );
    expect(entry).toMatchObject({ habitat: null, genus: null, flavorText: null, cryUrl: null });
  });
});
