import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { CATCH_CHANNEL, parseCatchEvent } from "./lib/catch-event";
import { spriteUrlFor } from "./lib/sprites";
import pokemonFixture from "./test-fixtures/pokemon-25.json";
import speciesFixture from "./test-fixtures/species-25.json";
import {
  createPokemonPlugin,
  FALLBACK_SPECIES_COUNT,
  isCatchEligible,
  pokemonRpcContract,
} from "./server";

type Contract = typeof pokemonRpcContract;
type Output<M extends keyof Contract> = Contract[M]["output"]["_zod"]["output"];

const SPECIES = [
  { id: 1, slug: "bulbasaur" },
  { id: 4, slug: "charmander" },
  { id: 25, slug: "pikachu" },
];

function fakePokeApi(online: boolean) {
  const paths: string[] = [];
  const fetch = async (url: string): Promise<Response> => {
    const path = url.replace("https://pokeapi.co/api/v2", "");
    paths.push(path);
    if (!online) throw new TypeError("fetch failed");
    if (path.startsWith("/pokemon-species?")) {
      return Response.json({
        count: SPECIES.length,
        results: SPECIES.map(({ id, slug }) => ({
          name: slug,
          url: `https://pokeapi.co/api/v2/pokemon-species/${id}/`,
        })),
      });
    }
    if (path === "/pokemon-species/25") return Response.json(speciesFixture);
    if (path === "/pokemon/25") return Response.json(pokemonFixture);
    return new Response("Not Found", { status: 404 });
  };
  return { fetch, paths };
}

async function setup({ online = true }: { online?: boolean } = {}) {
  const api = fakePokeApi(online);
  const { bb, harness } = createFakePluginHost({ pluginId: "pokemon" });
  // Always pick the last species in the list.
  await createPokemonPlugin({
    fetch: api.fetch,
    randomIndex: (maxExclusive) => maxExclusive - 1,
    now: () => 1_700_000_000_000,
  })(bb);

  const archive = (overrides: Parameters<typeof makeThreadResponse>[0] = {}) =>
    harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({
        id: "thr_1",
        title: "Fix login bug",
        parentThreadId: null,
        visibility: "visible",
        ...overrides,
      }),
    });
  const catches = () =>
    harness.inspection.realtimeSignals
      .filter((signal) => signal.channel === CATCH_CHANNEL)
      .map((signal) => parseCatchEvent(signal.payload));
  const rpc = async <M extends keyof Contract>(method: M, input: unknown) =>
    (await harness.behavior.callRpc(method, input)) as Output<M>;

  return { api, harness, archive, catches, rpc };
}

describe("isCatchEligible", () => {
  const thread = {
    id: "thr_1",
    title: null,
    titleFallback: null,
    parentThreadId: null,
    visibility: "visible",
    deletedAt: null,
  };

  it("only rewards visible top-level threads", () => {
    expect(isCatchEligible(thread)).toBe(true);
    expect(isCatchEligible({ ...thread, parentThreadId: "thr_parent" })).toBe(false);
    expect(isCatchEligible({ ...thread, visibility: "hidden" })).toBe(false);
    expect(isCatchEligible({ ...thread, deletedAt: 1 })).toBe(false);
  });
});

describe("catching on archive", () => {
  it("catches a random species from the PokeAPI list and announces it", async () => {
    const { archive, catches, rpc, api } = await setup();
    await archive();

    expect(api.paths[0]).toBe("/pokemon-species?limit=100000");
    expect(catches()).toEqual([
      {
        catchId: 1,
        speciesId: 25,
        name: "Pikachu",
        types: ["electric"],
        spriteUrl: spriteUrlFor(25),
        count: 1,
        caughtSpecies: 1,
        totalSpecies: 3,
        threadTitle: "Fix login bug",
      },
    ]);

    const pokedex = await rpc("getPokedex", null);
    expect(pokedex.speciesIds).toEqual([1, 4, 25]);
    expect(pokedex.totalCatches).toBe(1);
    expect(pokedex.caught).toEqual([
      expect.objectContaining({ speciesId: 25, name: "Pikachu", count: 1 }),
    ]);
    expect(pokedex.recent).toEqual([
      expect.objectContaining({ threadId: "thr_1", name: "Pikachu", threadTitle: "Fix login bug" }),
    ]);
  });

  it("awards a thread once, even when it is unarchived and archived again", async () => {
    const { archive, catches, rpc } = await setup();
    await archive();
    await archive();

    expect(catches()).toHaveLength(1);
    expect((await rpc("getPokedex", null)).totalCatches).toBe(1);
  });

  it("counts duplicate catches of the same species", async () => {
    const { archive, catches, rpc } = await setup();
    await archive({ id: "thr_1" });
    await archive({ id: "thr_2", title: null, titleFallback: "Refactor auth" });

    expect(catches().map((event) => [event?.count, event?.caughtSpecies])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    const entry = await rpc("getEntry", { speciesId: 25 });
    expect(entry.status).toBe("caught");
    if (entry.status !== "caught") return;
    expect(entry.tally.count).toBe(2);
    expect(entry.history.map((record) => record.threadTitle).sort()).toEqual([
      "Fix login bug",
      "Refactor auth",
    ]);
  });

  it("ignores cascaded child threads and hidden plugin threads", async () => {
    const { archive, catches } = await setup();
    await archive({ id: "thr_child", parentThreadId: "thr_parent" });
    await archive({ id: "thr_hidden", visibility: "hidden" });

    expect(catches()).toEqual([]);
  });

  it("still catches from the national dex when PokeAPI is unreachable", async () => {
    const { archive, catches, rpc } = await setup({ online: false });
    await archive();

    expect(catches()).toEqual([
      expect.objectContaining({
        speciesId: FALLBACK_SPECIES_COUNT,
        name: `Pokémon #${FALLBACK_SPECIES_COUNT}`,
        spriteUrl: spriteUrlFor(FALLBACK_SPECIES_COUNT),
        totalSpecies: FALLBACK_SPECIES_COUNT,
      }),
    ]);
    const entry = await rpc("getEntry", { speciesId: FALLBACK_SPECIES_COUNT });
    expect(entry).toMatchObject({ status: "caught", entry: null });
  });
});

describe("Pokédex entries", () => {
  it("keeps uncaught species locked without asking PokeAPI", async () => {
    const { rpc, api } = await setup();
    expect(await rpc("getEntry", { speciesId: 4 })).toEqual({ status: "uncaught" });
    expect(api.paths).not.toContain("/pokemon-species/4");
  });

  it("serves cached entries after the catch fetched them", async () => {
    const { archive, rpc, api } = await setup();
    await archive();
    const entry = await rpc("getEntry", { speciesId: 25 });

    expect(entry).toMatchObject({
      status: "caught",
      name: "Pikachu",
      entry: { genus: "Mouse Pokémon", types: ["electric"] },
    });
    expect(api.paths.filter((path) => path === "/pokemon-species/25")).toHaveLength(1);
  });

  it("syncs the species list in the background", async () => {
    const { harness, rpc } = await setup();
    expect(await rpc("getProgress", null)).toEqual({
      caughtSpecies: 0,
      totalSpecies: FALLBACK_SPECIES_COUNT,
    });

    const service = harness.behavior.runService("species-sync");
    await expect
      .poll(async () => (await rpc("getProgress", null)).totalSpecies)
      .toBe(SPECIES.length);
    service.controller.abort();
    await service.done;
  });
});
