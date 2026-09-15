import { useCallback, useEffect, useRef, useState } from "react";
import { useBbNavigate, useRealtime } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { PokemonSprite, TypeBadges } from "@/components/pokemon-bits";
import { CATCH_CHANNEL, parseCatchEvent, type CatchEvent } from "@/lib/catch-event";
import { formatDexNumber } from "@/lib/format";
import { POKEDEX_PATH } from "@/lib/routes";

const VISIBLE_MS = 9_000;
const MAX_CARDS = 3;

function CatchCard({
  event,
  onOpen,
  onDismiss,
}: {
  event: CatchEvent;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(VISIBLE_MS);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused]);

  const isNew = event.count === 1;
  return (
    <div
      className="pokemon-catch-card relative overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
      data-paused={paused}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Gotcha! ${event.name} was caught. Open it in the Pokédex.`}
        className="flex w-full items-center gap-3 p-3 pr-9 text-left hover:bg-state-hover"
      >
        <span aria-hidden className="pokemon-catch-stage relative size-20 shrink-0">
          <span className="pokemon-ball" />
          <PokemonSprite
            src={event.spriteUrl}
            caught
            className="pokemon-catch-sprite absolute inset-0 size-20"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Gotcha!
            {isNew ? (
              <span className="rounded-full bg-foreground px-1.5 text-[10px] font-semibold leading-4 text-background">
                NEW
              </span>
            ) : (
              <span className="tabular-nums">You have {event.count}</span>
            )}
          </span>
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-base font-semibold">{event.name}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {formatDexNumber(event.speciesId)}
            </span>
          </span>
          <TypeBadges types={event.types} />
          <span className="truncate text-xs text-muted-foreground">
            Archived “{event.threadTitle}”
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            Pokédex {event.caughtSpecies.toLocaleString()} /{" "}
            {event.totalSpecies.toLocaleString()}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
      >
        <Icon name="X" className="size-3.5" />
      </button>
      <span
        aria-hidden
        className="pokemon-catch-countdown absolute inset-x-0 bottom-0 h-0.5 bg-foreground/25"
        style={{ animationDuration: `${VISIBLE_MS}ms` }}
      />
    </div>
  );
}

/** Shows a card in the corner of the app for every Pokémon caught. */
export function CatchOverlay() {
  const navigate = useBbNavigate();
  const [catches, setCatches] = useState<CatchEvent[]>([]);

  const onCatch = useCallback((payload: unknown) => {
    const event = parseCatchEvent(payload);
    if (event === null) return;
    setCatches((current) =>
      [event, ...current.filter((candidate) => candidate.catchId !== event.catchId)].slice(
        0,
        MAX_CARDS,
      ),
    );
  }, []);
  useRealtime(CATCH_CHANNEL, onCatch);

  const dismiss = useCallback((catchId: number) => {
    setCatches((current) => current.filter((candidate) => candidate.catchId !== catchId));
  }, []);

  if (catches.length === 0) return null;
  return (
    <div className="pokemon-catch-stack" role="status" aria-live="polite">
      {catches.map((event) => (
        <CatchCard
          key={event.catchId}
          event={event}
          onDismiss={() => dismiss(event.catchId)}
          onOpen={() => {
            dismiss(event.catchId);
            navigate.toPluginPanel(POKEDEX_PATH, { subPath: String(event.speciesId) });
          }}
        />
      ))}
    </div>
  );
}
