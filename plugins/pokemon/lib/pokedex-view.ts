import { formatDexNumber } from "./format";

export type DexFilter = "all" | "caught" | "missing";

export interface DexCell<Caught extends { name: string }> {
  speciesId: number;
  caught: Caught | null;
}

export function buildDexCells<Caught extends { speciesId: number; name: string }>(
  speciesIds: readonly number[],
  caught: readonly Caught[],
): DexCell<Caught>[] {
  const bySpecies = new Map(caught.map((species) => [species.speciesId, species]));
  return speciesIds.map((speciesId) => ({
    speciesId,
    caught: bySpecies.get(speciesId) ?? null,
  }));
}

/**
 * Numbers match the national dex number; text matches only caught names so
 * search never spoils a Pokémon you have not found yet.
 */
export function filterDexCells<Caught extends { name: string }>(
  cells: readonly DexCell<Caught>[],
  filter: DexFilter,
  query: string,
): DexCell<Caught>[] {
  const needle = query.trim().toLowerCase().replace(/^#/, "");
  const numeric = /^\d+$/.test(needle);
  return cells.filter((cell) => {
    if (filter === "caught" && cell.caught === null) return false;
    if (filter === "missing" && cell.caught !== null) return false;
    if (needle === "") return true;
    if (numeric) return formatDexNumber(cell.speciesId).includes(needle);
    return cell.caught?.name.toLowerCase().includes(needle) ?? false;
  });
}

export function completionPercent(caught: number, total: number): string {
  if (total <= 0 || caught <= 0) return "0%";
  const percent = (caught / total) * 100;
  if (percent >= 100) return "100%";
  return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.floor(percent)}%`;
}
