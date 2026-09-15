import { z } from "zod";

export const POKEAPI_BASE_URL = "https://pokeapi.co/api/v2";
const REQUEST_TIMEOUT_MS = 15_000;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SpeciesRef {
  id: number;
  slug: string;
}

/** The trimmed Pokédex entry this plugin caches and renders. */
export const dexEntrySchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
  name: z.string(),
  genus: z.string().nullable(),
  flavorText: z.string().nullable(),
  flavorVersion: z.string().nullable(),
  types: z.array(z.string()),
  heightDm: z.number(),
  weightHg: z.number(),
  abilities: z.array(z.object({ slug: z.string(), hidden: z.boolean() })),
  stats: z.array(z.object({ slug: z.string(), value: z.number() })),
  generation: z.string().nullable(),
  habitat: z.string().nullable(),
  captureRate: z.number().nullable(),
  isLegendary: z.boolean(),
  isMythical: z.boolean(),
  spriteUrl: z.string().nullable(),
  artworkUrl: z.string().nullable(),
  cryUrl: z.string().nullable(),
});
export type DexEntry = z.infer<typeof dexEntrySchema>;

const resourceSchema = z.object({ name: z.string(), url: z.string() });

const speciesListSchema = z.object({ results: z.array(resourceSchema) });

// Only the fields the entry reads; zod strips the rest of PokeAPI's payload.
const speciesSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  names: z.array(z.object({ name: z.string(), language: resourceSchema })),
  genera: z.array(z.object({ genus: z.string(), language: resourceSchema })),
  flavor_text_entries: z.array(
    z.object({
      flavor_text: z.string(),
      language: resourceSchema,
      version: resourceSchema.nullish(),
    }),
  ),
  generation: resourceSchema.nullish(),
  habitat: resourceSchema.nullish(),
  capture_rate: z.number().nullish(),
  is_legendary: z.boolean(),
  is_mythical: z.boolean(),
  varieties: z.array(
    z.object({ is_default: z.boolean(), pokemon: resourceSchema }),
  ),
});

const pokemonSchema = z.object({
  height: z.number(),
  weight: z.number(),
  types: z.array(z.object({ slot: z.number(), type: resourceSchema })),
  abilities: z.array(
    z.object({ slot: z.number(), is_hidden: z.boolean(), ability: resourceSchema }),
  ),
  stats: z.array(z.object({ base_stat: z.number(), stat: resourceSchema })),
  sprites: z.object({
    front_default: z.string().nullish(),
    other: z
      .object({
        "official-artwork": z
          .object({ front_default: z.string().nullish() })
          .nullish(),
      })
      .nullish(),
  }),
  cries: z
    .object({ latest: z.string().nullish(), legacy: z.string().nullish() })
    .nullish(),
});

export function idFromResourceUrl(url: string): number | null {
  const match = /\/(\d+)\/?$/.exec(url);
  if (match === null) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function parseSpeciesList(value: unknown): SpeciesRef[] {
  return speciesListSchema
    .parse(value)
    .results.flatMap((result) => {
      const id = idFromResourceUrl(result.url);
      return id === null ? [] : [{ id, slug: result.name }];
    })
    .sort((left, right) => left.id - right.id);
}

/** Joins the hard line breaks and form feeds the game text was typeset with. */
export function cleanFlavorText(text: string): string {
  return text
    .replace(/\u00ad\s*/g, "")
    .replace(/-\s*[\n\f]\s*/g, "-")
    .replace(/\s+/g, " ")
    .replace(/POKéMON/g, "Pokémon")
    .trim();
}

function english<T extends { language: { name: string } }>(
  entries: readonly T[],
): T[] {
  return entries.filter((entry) => entry.language.name === "en");
}

export function toDexEntry(speciesValue: unknown, pokemonValue: unknown): DexEntry {
  const species = speciesSchema.parse(speciesValue);
  const pokemon = pokemonSchema.parse(pokemonValue);
  // PokeAPI lists flavor text oldest game first, so the last English entry is
  // the most recent one.
  const flavor = english(species.flavor_text_entries).at(-1);
  return {
    id: species.id,
    slug: species.name,
    name: english(species.names)[0]?.name ?? species.name,
    genus: english(species.genera)[0]?.genus ?? null,
    flavorText: flavor === undefined ? null : cleanFlavorText(flavor.flavor_text),
    flavorVersion: flavor?.version?.name ?? null,
    types: [...pokemon.types]
      .sort((left, right) => left.slot - right.slot)
      .map((entry) => entry.type.name),
    heightDm: pokemon.height,
    weightHg: pokemon.weight,
    abilities: [...pokemon.abilities]
      .sort((left, right) => left.slot - right.slot)
      .map((entry) => ({ slug: entry.ability.name, hidden: entry.is_hidden })),
    stats: pokemon.stats.map((entry) => ({
      slug: entry.stat.name,
      value: entry.base_stat,
    })),
    generation: species.generation?.name ?? null,
    habitat: species.habitat?.name ?? null,
    captureRate: species.capture_rate ?? null,
    isLegendary: species.is_legendary,
    isMythical: species.is_mythical,
    spriteUrl: pokemon.sprites.front_default ?? null,
    artworkUrl: pokemon.sprites.other?.["official-artwork"]?.front_default ?? null,
    cryUrl: pokemon.cries?.latest ?? pokemon.cries?.legacy ?? null,
  };
}

async function getJson(
  fetchImpl: Fetch,
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(`${POKEAPI_BASE_URL}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  });
  if (!response.ok) {
    throw new Error(`PokeAPI ${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchSpeciesList(
  fetchImpl: Fetch,
  signal: AbortSignal,
): Promise<SpeciesRef[]> {
  return parseSpeciesList(
    await getJson(fetchImpl, "/pokemon-species?limit=100000", signal),
  );
}

export async function fetchDexEntry(
  fetchImpl: Fetch,
  speciesId: number,
  signal: AbortSignal,
): Promise<DexEntry> {
  const species = await getJson(fetchImpl, `/pokemon-species/${speciesId}`, signal);
  const parsed = speciesSchema.parse(species);
  const variety =
    parsed.varieties.find((candidate) => candidate.is_default) ??
    parsed.varieties[0];
  const pokemonId =
    (variety === undefined ? null : idFromResourceUrl(variety.pokemon.url)) ??
    speciesId;
  const pokemon = await getJson(fetchImpl, `/pokemon/${pokemonId}`, signal);
  return toDexEntry(species, pokemon);
}
