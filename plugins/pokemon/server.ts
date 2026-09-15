import { randomInt } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CATCH_CHANNEL, type CatchEvent } from "./lib/catch-event";
import { formatDexNumber, titleCaseSlug } from "./lib/format";
import {
  dexEntrySchema,
  fetchDexEntry,
  fetchSpeciesList,
  type DexEntry,
  type Fetch,
} from "./lib/pokeapi";
import { MIGRATIONS, PokedexStore } from "./lib/pokedex-store";
import { spriteUrlFor } from "./lib/sprites";

/** National Pokédex size, used only until PokeAPI has been reachable once. */
export const FALLBACK_SPECIES_COUNT = 1025;
const SPECIES_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const SPECIES_RETRY_MS = 10 * 60 * 1000;
const HISTORY_LIMIT = 25;
const RECENT_LIMIT = 8;

const tallySchema = z.object({
  speciesId: z.number().int(),
  count: z.number().int(),
  firstCaughtAt: z.number(),
  lastCaughtAt: z.number(),
});

const catchSchema = z.object({
  id: z.number().int(),
  threadId: z.string(),
  threadTitle: z.string(),
  speciesId: z.number().int(),
  caughtAt: z.number(),
});

const caughtSpeciesSchema = tallySchema.extend({
  name: z.string(),
  types: z.array(z.string()),
  spriteUrl: z.string().nullable(),
});
export type CaughtSpecies = z.infer<typeof caughtSpeciesSchema>;

const recentCatchSchema = catchSchema.extend({
  name: z.string(),
  spriteUrl: z.string().nullable(),
});
export type RecentCatch = z.infer<typeof recentCatchSchema>;

export const pokemonRpcContract = defineRpcContract({
  getProgress: {
    input: z.null(),
    output: z.object({
      caughtSpecies: z.number().int(),
      totalSpecies: z.number().int(),
    }),
  },
  getPokedex: {
    input: z.null(),
    output: z.object({
      speciesIds: z.array(z.number().int()),
      caught: z.array(caughtSpeciesSchema),
      recent: z.array(recentCatchSchema),
      totalCatches: z.number().int(),
    }),
  },
  getEntry: {
    input: z.object({ speciesId: z.number().int().positive() }).strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("uncaught") }),
      z.object({
        status: z.literal("caught"),
        name: z.string(),
        // Null when PokeAPI is unreachable and the entry was never cached.
        entry: dexEntrySchema.nullable(),
        tally: tallySchema,
        history: z.array(catchSchema),
      }),
    ]),
  },
});

interface ArchivedThread {
  id: string;
  title: string | null;
  titleFallback: string | null;
  parentThreadId: string | null;
  visibility: string;
  deletedAt: number | null;
}

/**
 * Only threads the user manages directly earn a catch. Archiving a parent
 * cascades to its children, and hidden threads are plugin workers.
 */
export function isCatchEligible(thread: ArchivedThread): boolean {
  return (
    thread.parentThreadId === null &&
    thread.visibility === "visible" &&
    thread.deletedAt === null
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface PokemonPluginOptions {
  fetch?: Fetch;
  /** Returns an integer in [0, maxExclusive). */
  randomIndex?: (maxExclusive: number) => number;
  now?: () => number;
}

export function createPokemonPlugin(options: PokemonPluginOptions = {}) {
  const fetchImpl: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const randomIndex = options.randomIndex ?? ((maxExclusive) => randomInt(maxExclusive));
  const now = options.now ?? Date.now;

  return async function plugin(bb: BbPluginApi) {
    const db = bb.storage.database();
    bb.storage.migrate(db, MIGRATIONS);
    const store = new PokedexStore(db);
    const lifetime = new AbortController();
    bb.onDispose(() => lifetime.abort());

    let speciesSync: Promise<void> | null = null;
    const syncSpecies = (): Promise<void> => {
      speciesSync ??= fetchSpeciesList(fetchImpl, lifetime.signal)
        .then((species) => {
          if (species.length === 0) throw new Error("PokeAPI returned no species");
          if (!lifetime.signal.aborted) store.replaceSpecies(species, now());
        })
        .finally(() => {
          speciesSync = null;
        });
      return speciesSync;
    };

    const speciesIds = (): number[] => {
      const ids = store.speciesIds();
      return ids.length > 0
        ? ids
        : Array.from({ length: FALLBACK_SPECIES_COUNT }, (_, index) => index + 1);
    };

    const pendingEntries = new Map<number, Promise<DexEntry | null>>();
    const loadEntry = (speciesId: number): Promise<DexEntry | null> => {
      const cached = store.entry(speciesId);
      if (cached !== null) return Promise.resolve(cached);
      let pending = pendingEntries.get(speciesId);
      if (pending === undefined) {
        pending = fetchDexEntry(fetchImpl, speciesId, lifetime.signal)
          .then(
            (entry) => {
              if (!lifetime.signal.aborted) store.saveEntry(entry, now());
              return entry;
            },
            (error: unknown) => {
              if (!lifetime.signal.aborted) {
                bb.log.warn(
                  `Could not load Pokédex entry ${formatDexNumber(speciesId)}: ${errorMessage(error)}`,
                );
              }
              return null;
            },
          )
          .finally(() => pendingEntries.delete(speciesId));
        pendingEntries.set(speciesId, pending);
      }
      return pending;
    };

    const displayName = (speciesId: number, entry: DexEntry | null): string => {
      if (entry !== null) return entry.name;
      const slug = store.speciesSlug(speciesId);
      return slug === null ? `Pokémon ${formatDexNumber(speciesId)}` : titleCaseSlug(slug);
    };

    bb.events.on("thread.archived", async ({ thread }) => {
      if (!isCatchEligible(thread) || store.hasCatchForThread(thread.id)) return;
      if (store.speciesIds().length === 0) {
        await syncSpecies().catch((error: unknown) =>
          bb.log.warn(`Using the fallback Pokémon list: ${errorMessage(error)}`),
        );
        if (lifetime.signal.aborted) return;
      }
      const ids = speciesIds();
      const speciesId = ids[randomIndex(ids.length)];
      if (speciesId === undefined) return;
      const record = store.recordCatch({
        threadId: thread.id,
        threadTitle: thread.title ?? thread.titleFallback ?? "Untitled thread",
        speciesId,
        caughtAt: now(),
      });
      if (record === null) return;

      const entry = await loadEntry(speciesId);
      if (lifetime.signal.aborted) return;
      bb.realtime.publish(CATCH_CHANNEL, {
        catchId: record.id,
        speciesId,
        name: displayName(speciesId, entry),
        types: entry?.types ?? [],
        spriteUrl: entry?.spriteUrl ?? spriteUrlFor(speciesId),
        count: store.tally(speciesId)?.count ?? 1,
        caughtSpecies: store.tallies().length,
        totalSpecies: ids.length,
        threadTitle: record.threadTitle,
      } satisfies CatchEvent);
    });

    bb.rpc.register(pokemonRpcContract, {
      async getProgress() {
        return {
          caughtSpecies: store.tallies().length,
          totalSpecies: speciesIds().length,
        };
      },
      async getPokedex() {
        const tallies = store.tallies();
        const recent = store.recentCatches(RECENT_LIMIT);
        const entries = store.entries([
          ...tallies.map((tally) => tally.speciesId),
          ...recent.map((record) => record.speciesId),
        ]);
        const summarize = (speciesId: number) => {
          const entry = entries.get(speciesId) ?? null;
          return {
            name: displayName(speciesId, entry),
            types: entry?.types ?? [],
            spriteUrl: entry?.spriteUrl ?? spriteUrlFor(speciesId),
          };
        };
        return {
          speciesIds: speciesIds(),
          caught: tallies.map((tally) => ({ ...tally, ...summarize(tally.speciesId) })),
          recent: recent.map((record) => {
            const { name, spriteUrl } = summarize(record.speciesId);
            return { ...record, name, spriteUrl };
          }),
          totalCatches: store.totalCatches(),
        };
      },
      async getEntry({ speciesId }) {
        const tally = store.tally(speciesId);
        if (tally === null) return { status: "uncaught" as const };
        const entry = await loadEntry(speciesId);
        return {
          status: "caught" as const,
          name: displayName(speciesId, entry),
          entry,
          tally,
          history: store.catchHistory(speciesId, HISTORY_LIMIT),
        };
      },
    });

    bb.background.service("species-sync", {
      async start(signal) {
        while (!signal.aborted) {
          const syncedAt = store.speciesSyncedAt();
          const age = syncedAt === null ? Number.POSITIVE_INFINITY : now() - syncedAt;
          // Clamped so a clock that jumped backwards cannot overflow setTimeout.
          let delay = Math.min(SPECIES_REFRESH_MS - age, SPECIES_REFRESH_MS);
          if (delay <= 0) {
            try {
              await syncSpecies();
              delay = SPECIES_REFRESH_MS;
            } catch (error) {
              if (signal.aborted) return;
              bb.log.warn(`Could not load the Pokémon list from PokeAPI: ${errorMessage(error)}`);
              delay = SPECIES_RETRY_MS;
            }
          }
          await sleep(delay, signal);
        }
      },
    });
  };
}

export default createPokemonPlugin();
