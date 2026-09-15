export function formatDexNumber(speciesId: number): string {
  return `#${String(speciesId).padStart(3, "0")}`;
}

/** "lightning-rod" → "Lightning Rod". */
export function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

const GENERATION_PREFIX = "generation-";

/** "generation-iv" → "Generation IV". */
export function formatGeneration(slug: string): string {
  return slug.startsWith(GENERATION_PREFIX)
    ? `Generation ${slug.slice(GENERATION_PREFIX.length).toUpperCase()}`
    : titleCaseSlug(slug);
}

/** PokeAPI heights are decimetres. */
export function formatHeight(decimetres: number): string {
  const totalInches = Math.round(decimetres * 3.937_007_874);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${(decimetres / 10).toFixed(1)} m · ${feet}′${String(inches).padStart(2, "0")}″`;
}

/** PokeAPI weights are hectograms. */
export function formatWeight(hectograms: number): string {
  return `${(hectograms / 10).toFixed(1)} kg · ${(hectograms * 0.220_462_262).toFixed(1)} lb`;
}

export const STAT_LABELS: Readonly<Record<string, string>> = {
  hp: "HP",
  attack: "Attack",
  defense: "Defense",
  "special-attack": "Sp. Atk",
  "special-defense": "Sp. Def",
  speed: "Speed",
};

/** The highest base stat any Pokémon has (Blissey's HP), for bar scaling. */
export const MAX_BASE_STAT = 255;

// Content colors for type badges, not UI chrome, so they stay fixed across
// themes the way they do in the games.
export const TYPE_COLORS: Readonly<Record<string, string>> = {
  normal: "#9fa19f",
  fire: "#e62829",
  water: "#2980ef",
  electric: "#d8b100",
  grass: "#3fa129",
  ice: "#3dcef3",
  fighting: "#ff8000",
  poison: "#9141cb",
  ground: "#915121",
  flying: "#81b9ef",
  psychic: "#ef4179",
  bug: "#91a119",
  rock: "#afa981",
  ghost: "#704170",
  dragon: "#5060e1",
  dark: "#624d4e",
  steel: "#60a1b8",
  fairy: "#ef70ef",
};

export function formatRelativeTime(timestamp: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : formatDate(timestamp);
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Pokédex routes use the national number as the panel sub-path. */
export function parseSpeciesSubPath(subPath: string): number | null {
  const match = /^(\d{1,5})\/?$/.exec(subPath.trim());
  if (match === null) return null;
  const id = Number(match[1]);
  return id > 0 ? id : null;
}
