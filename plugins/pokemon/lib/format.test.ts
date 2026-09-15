import { describe, expect, it } from "vitest";
import {
  formatDexNumber,
  formatGeneration,
  formatHeight,
  formatRelativeTime,
  formatWeight,
  parseSpeciesSubPath,
  titleCaseSlug,
} from "./format";
import { completionPercent, filterDexCells } from "./pokedex-view";

describe("format", () => {
  it("pads national dex numbers to three digits", () => {
    expect(formatDexNumber(1)).toBe("#001");
    expect(formatDexNumber(25)).toBe("#025");
    expect(formatDexNumber(1025)).toBe("#1025");
  });

  it("title-cases PokeAPI slugs", () => {
    expect(titleCaseSlug("lightning-rod")).toBe("Lightning Rod");
    expect(formatGeneration("generation-ix")).toBe("Generation IX");
  });

  it("converts decimetres and hectograms", () => {
    expect(formatHeight(4)).toBe("0.4 m · 1′04″");
    expect(formatHeight(17)).toBe("1.7 m · 5′07″");
    expect(formatWeight(60)).toBe("6.0 kg · 13.2 lb");
  });

  it("formats relative catch times", () => {
    const now = Date.UTC(2026, 8, 15, 12);
    expect(formatRelativeTime(now - 10_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 59 * 60_000 - 59_000, now)).toBe("59m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  it("parses a species sub-path", () => {
    expect(parseSpeciesSubPath("25")).toBe(25);
    expect(parseSpeciesSubPath("25/")).toBe(25);
    expect(parseSpeciesSubPath("")).toBeNull();
    expect(parseSpeciesSubPath("0")).toBeNull();
    expect(parseSpeciesSubPath("pikachu")).toBeNull();
  });
});

describe("pokedex view", () => {
  const cells = [
    { speciesId: 1, caught: { name: "Bulbasaur" } },
    { speciesId: 25, caught: { name: "Pikachu" } },
    { speciesId: 125, caught: null },
    { speciesId: 150, caught: null },
  ];

  it("filters caught and missing species", () => {
    expect(filterDexCells(cells, "caught", "").map((cell) => cell.speciesId)).toEqual([1, 25]);
    expect(filterDexCells(cells, "missing", "").map((cell) => cell.speciesId)).toEqual([125, 150]);
  });

  it("matches numbers against every species but names only against catches", () => {
    expect(filterDexCells(cells, "all", "#25").map((cell) => cell.speciesId)).toEqual([25, 125]);
    expect(filterDexCells(cells, "all", "pika").map((cell) => cell.speciesId)).toEqual([25]);
    // Mewtwo (#150) is uncaught, so its name must not match.
    expect(filterDexCells(cells, "all", "mewtwo")).toEqual([]);
  });

  it("reports completion without rounding up to 100%", () => {
    expect(completionPercent(0, 1025)).toBe("0%");
    expect(completionPercent(12, 1025)).toBe("1.2%");
    expect(completionPercent(1024, 1025)).toBe("99%");
    expect(completionPercent(1025, 1025)).toBe("100%");
  });
});
