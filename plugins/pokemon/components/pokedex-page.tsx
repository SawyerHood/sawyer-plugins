import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
  type PluginRpcResult,
} from "@get-bb/plugin-sdk/app";
import type { CaughtSpecies, pokemonRpcContract, RecentCatch } from "../server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PokemonSprite, TypeBadges } from "@/components/pokemon-bits";
import {
  MAX_BASE_STAT,
  STAT_LABELS,
  formatDate,
  formatDexNumber,
  formatGeneration,
  formatHeight,
  formatRelativeTime,
  formatWeight,
  parseSpeciesSubPath,
  titleCaseSlug,
} from "@/lib/format";
import type { DexEntry } from "@/lib/pokeapi";
import {
  buildDexCells,
  completionPercent,
  filterDexCells,
  type DexCell,
  type DexFilter,
} from "@/lib/pokedex-view";
import { POKEDEX_PATH } from "@/lib/routes";
import { artworkUrlFor, spriteUrlFor } from "@/lib/sprites";
import { usePokedexSignal } from "@/lib/use-pokedex-signal";
import { cn } from "@/lib/utils";

type Rpc = typeof pokemonRpcContract;
type PokedexData = PluginRpcResult<Rpc["getPokedex"]>;
type EntryResult = PluginRpcResult<Rpc["getEntry"]>;
type CaughtEntry = Extract<EntryResult, { status: "caught" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function ProgressSummary({ pokedex }: { pokedex: PokedexData }) {
  const caught = pokedex.caught.length;
  const total = pokedex.speciesIds.length;
  const percent = completionPercent(caught, total);
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <div className="text-sm text-muted-foreground">Caught</div>
          <div className="text-2xl font-semibold tabular-nums">
            {caught.toLocaleString()}
            <span className="text-base font-normal text-muted-foreground">
              {" "}
              / {total.toLocaleString()}
            </span>
          </div>
        </div>
        <div className="text-sm tabular-nums text-muted-foreground">
          {percent} complete · {pokedex.totalCatches.toLocaleString()}{" "}
          {pokedex.totalCatches === 1 ? "catch" : "catches"}
        </div>
      </div>
      <div
        role="progressbar"
        aria-label="Pokédex completion"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={caught}
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-foreground/80"
          style={{ width: total === 0 ? 0 : `${(caught / total) * 100}%` }}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Archive a thread to catch a random Pokémon. Duplicates count too.
      </p>
    </section>
  );
}

function RecentCatches({
  recent,
  onSelect,
}: {
  recent: readonly RecentCatch[];
  onSelect: (speciesId: number) => void;
}) {
  const now = Date.now();
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">Recent catches</h2>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {recent.map((record) => (
          <li key={record.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onSelect(record.speciesId)}
              title={`Archived “${record.threadTitle}”`}
              className="flex w-44 items-center gap-2 rounded-lg border border-border bg-card p-1.5 pr-2.5 text-left hover:bg-state-hover"
            >
              <PokemonSprite src={record.spriteUrl} caught className="size-10 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{record.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {formatRelativeTime(record.caughtAt, now)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FILTERS: readonly { id: DexFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "caught", label: "Caught" },
  { id: "missing", label: "Missing" },
];

function DexCellButton({
  cell,
  selected,
  onSelect,
}: {
  cell: DexCell<CaughtSpecies>;
  selected: boolean;
  onSelect: () => void;
}) {
  const { speciesId, caught } = cell;
  const number = formatDexNumber(speciesId);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={
        caught === null
          ? `${number}, not caught yet`
          : `${number} ${caught.name}, caught ${caught.count} ${caught.count === 1 ? "time" : "times"}`
      }
      className={cn(
        "relative flex w-full flex-col items-center rounded-lg border border-border px-1.5 pb-2 pt-1.5 hover:bg-state-hover",
        caught === null ? "bg-transparent" : "bg-card",
        selected && "border-foreground/60 bg-state-active",
      )}
    >
      <span className="self-start font-mono text-[11px] text-muted-foreground">{number}</span>
      <PokemonSprite
        src={caught?.spriteUrl ?? spriteUrlFor(speciesId)}
        caught={caught !== null}
        className="size-20"
      />
      <span
        className={cn(
          "w-full truncate text-center text-xs",
          caught === null ? "text-muted-foreground" : "font-medium",
        )}
      >
        {caught?.name ?? "???"}
      </span>
      {caught !== null && caught.count > 1 ? (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-muted px-1.5 text-[10px] font-medium leading-4 tabular-nums">
          ×{caught.count}
        </span>
      ) : null}
    </button>
  );
}

function DexGrid({
  pokedex,
  selectedId,
  onSelect,
}: {
  pokedex: PokedexData;
  selectedId: number | null;
  onSelect: (speciesId: number) => void;
}) {
  const [filter, setFilter] = useState<DexFilter>("all");
  const [query, setQuery] = useState("");
  const cells = useMemo(
    () => buildDexCells(pokedex.speciesIds, pokedex.caught),
    [pokedex],
  );
  const visible = useMemo(() => filterDexCells(cells, filter, query), [cells, filter, query]);
  const counts: Record<DexFilter, number> = {
    all: cells.length,
    caught: pokedex.caught.length,
    missing: cells.length - pokedex.caught.length,
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or number"
            aria-label="Search the Pokédex"
            className="pl-8"
          />
        </div>
        <div role="group" aria-label="Filter" className="flex rounded-md border border-border p-0.5">
          {FILTERS.map(({ id, label }) => (
            <Button
              key={id}
              variant="ghost"
              size="sm"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className="h-7 gap-1.5 px-2.5"
            >
              {label}
              <span className="tabular-nums text-muted-foreground">
                {counts[id].toLocaleString()}
              </span>
            </Button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState>No Pokémon match.</EmptyState>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
          {visible.map((cell) => (
            <li key={cell.speciesId} className="pokemon-dex-cell">
              <DexCellButton
                cell={cell}
                selected={cell.speciesId === selectedId}
                onSelect={() => onSelect(cell.speciesId)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function BaseStats({ stats }: { stats: DexEntry["stats"] }) {
  const total = stats.reduce((sum, stat) => sum + stat.value, 0);
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">Base stats</h3>
      <dl className="space-y-1.5">
        {stats.map((stat) => (
          <div key={stat.slug} className="grid grid-cols-[4rem_2rem_1fr] items-center gap-2 text-xs">
            <dt className="text-muted-foreground">{STAT_LABELS[stat.slug] ?? titleCaseSlug(stat.slug)}</dt>
            <dd className="text-right font-medium tabular-nums">{stat.value}</dd>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/70"
                style={{ width: `${Math.min(100, (stat.value / MAX_BASE_STAT) * 100)}%` }}
              />
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[4rem_2rem_1fr] items-center gap-2 border-t border-border pt-1.5 text-xs">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="text-right font-semibold tabular-nums">{total}</dd>
        </div>
      </dl>
    </section>
  );
}

function Artwork({ src, caught }: { src: string; caught: boolean }) {
  return (
    <div className="pokemon-artwork relative flex aspect-square max-h-72 w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40">
      <PokemonSprite
        src={src}
        caught={caught}
        pixelated={false}
        className="relative size-[80%]"
      />
    </div>
  );
}

function playCry(url: string): void {
  const audio = new Audio(url);
  audio.volume = 0.4;
  void audio.play().catch(() => undefined);
}

function CaughtEntryView({ speciesId, result }: { speciesId: number; result: CaughtEntry }) {
  const navigate = useBbNavigate();
  const { entry, tally, history } = result;
  const now = Date.now();
  return (
    <div className="space-y-5">
      <Artwork src={entry?.artworkUrl ?? artworkUrlFor(speciesId)} caught />
      <header className="space-y-1">
        <div className="font-mono text-xs text-muted-foreground">{formatDexNumber(speciesId)}</div>
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-xl font-semibold">{result.name}</h2>
          {entry?.cryUrl ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={`Play ${result.name}'s cry`}
              onClick={() => playCry(entry.cryUrl!)}
            >
              <Icon name="Play" className="size-3.5" />
            </Button>
          ) : null}
        </div>
        {entry?.genus ? <div className="text-sm text-muted-foreground">{entry.genus}</div> : null}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <TypeBadges types={entry?.types ?? []} />
          {entry?.isLegendary ? (
            <span className="rounded-full bg-muted px-2 text-[11px] font-medium leading-5">Legendary</span>
          ) : null}
          {entry?.isMythical ? (
            <span className="rounded-full bg-muted px-2 text-[11px] font-medium leading-5">Mythical</span>
          ) : null}
        </div>
      </header>

      <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
        <span className="font-medium tabular-nums">
          Caught {tally.count} {tally.count === 1 ? "time" : "times"}
        </span>
        <span className="text-muted-foreground"> · first on {formatDate(tally.firstCaughtAt)}</span>
      </div>

      {entry === null ? (
        <EmptyState>PokeAPI is unreachable, so this entry has not loaded yet.</EmptyState>
      ) : (
        <>
          {entry.flavorText ? (
            <figure className="space-y-1">
              <blockquote className="text-sm leading-relaxed">{entry.flavorText}</blockquote>
              {entry.flavorVersion ? (
                <figcaption className="text-xs text-muted-foreground">
                  Pokémon {titleCaseSlug(entry.flavorVersion)}
                </figcaption>
              ) : null}
            </figure>
          ) : null}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Height">{formatHeight(entry.heightDm)}</Fact>
            <Fact label="Weight">{formatWeight(entry.weightHg)}</Fact>
            <Fact label="Abilities">
              {entry.abilities
                .map((ability) => `${titleCaseSlug(ability.slug)}${ability.hidden ? " (hidden)" : ""}`)
                .join(", ")}
            </Fact>
            <Fact label="Habitat">{entry.habitat ? titleCaseSlug(entry.habitat) : "Unknown"}</Fact>
            {entry.generation ? (
              <Fact label="Introduced">{formatGeneration(entry.generation)}</Fact>
            ) : null}
            {entry.captureRate !== null ? (
              <Fact label="Capture rate">{entry.captureRate}</Fact>
            ) : null}
          </dl>
          <BaseStats stats={entry.stats} />
        </>
      )}

      <section>
        <h3 className="mb-2 text-sm font-medium">Caught from</h3>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {history.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => navigate.toThread(record.threadId)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-state-hover"
              >
                <span className="min-w-0 flex-1 truncate">{record.threadTitle}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeTime(record.caughtAt, now)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {tally.count > history.length ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Showing the latest {history.length} of {tally.count}.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function EntryPanel({ speciesId, onBack }: { speciesId: number | null; onBack: () => void }) {
  const rpc = useRpc<Rpc>();
  const [loaded, setLoaded] = useState<
    { speciesId: number; result: EntryResult } | { speciesId: number; error: string } | null
  >(null);
  const latestRequest = useRef<number | null>(null);
  const refetch = useCallback(() => {
    latestRequest.current = speciesId;
    if (speciesId === null) return;
    rpc.call("getEntry", { speciesId }).then(
      (result) => {
        if (latestRequest.current === speciesId) setLoaded({ speciesId, result });
      },
      (error: unknown) => {
        if (latestRequest.current === speciesId) {
          setLoaded({ speciesId, error: errorMessage(error) });
        }
      },
    );
  }, [rpc, speciesId]);
  usePokedexSignal(refetch);

  let body: ReactNode;
  if (speciesId === null) {
    body = (
      <EmptyState>
        No Pokémon yet. Archive a thread to catch your first one.
      </EmptyState>
    );
  } else if (loaded === null || loaded.speciesId !== speciesId) {
    body = <EmptyState>Loading Pokédex entry…</EmptyState>;
  } else if ("error" in loaded) {
    body = <p role="alert" className="text-sm text-destructive">{loaded.error}</p>;
  } else if (loaded.result.status === "uncaught") {
    body = (
      <div className="space-y-4">
        <Artwork src={artworkUrlFor(speciesId)} caught={false} />
        <div>
          <div className="font-mono text-xs text-muted-foreground">{formatDexNumber(speciesId)}</div>
          <h2 className="text-xl font-semibold">???</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Not caught yet. Keep archiving threads to find it.
          </p>
        </div>
      </div>
    );
  } else {
    body = <CaughtEntryView speciesId={speciesId} result={loaded.result} />;
  }

  return (
    <div className="p-4 md:p-5">
      {/* Hidden on a wrapper: the host's own .inline-flex outranks lg:hidden on the button. */}
      <div className="mb-3 lg:hidden">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1" onClick={onBack}>
          <Icon name="ChevronLeft" className="size-4" />
          Pokédex
        </Button>
      </div>
      {body}
    </div>
  );
}

export function PokedexPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<Rpc>();
  const navigate = useBbNavigate();
  const [pokedex, setPokedex] = useState<PokedexData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("getPokedex", null).then(
      (result) => {
        setPokedex(result);
        setError(null);
      },
      (cause: unknown) => setError(errorMessage(cause)),
    );
  }, [rpc]);
  usePokedexSignal(refetch);

  const selectedId = parseSpeciesSubPath(subPath);
  const select = (speciesId: number | null) =>
    navigate.toPluginPanel(POKEDEX_PATH, {
      subPath: speciesId === null ? "" : String(speciesId),
    });
  // Wide layouts always show an entry: the selection, else the latest catch.
  const detailId = selectedId ?? pokedex?.recent[0]?.speciesId ?? null;

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div
        className={cn(
          "h-full min-h-0 min-w-0 flex-1 overflow-y-auto",
          selectedId !== null && "max-lg:hidden",
        )}
      >
        <div className="mx-auto box-border w-full max-w-5xl space-y-5 px-4 pb-8 pt-3 md:px-5 md:pt-4">
          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {pokedex === null ? (
            <EmptyState>Loading Pokédex…</EmptyState>
          ) : (
            <>
              <ProgressSummary pokedex={pokedex} />
              {pokedex.recent.length > 0 ? (
                <RecentCatches recent={pokedex.recent} onSelect={select} />
              ) : null}
              <DexGrid pokedex={pokedex} selectedId={detailId} onSelect={select} />
            </>
          )}
        </div>
      </div>
      <aside
        aria-label="Pokédex entry"
        className={cn(
          "h-full min-h-0 overflow-y-auto border-border max-lg:w-full lg:w-[22rem] lg:shrink-0 lg:border-l",
          selectedId === null && "max-lg:hidden",
        )}
      >
        {pokedex === null ? null : <EntryPanel speciesId={detailId} onBack={() => select(null)} />}
      </aside>
    </div>
  );
}
