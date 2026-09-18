// Auto Dispatch frontend: the Auto toggle in the New thread composer, and the
// plugin's settings sections: which projects and environments Auto may choose
// between, the model rotation, and a routing test.
import {
  type CSSProperties,
  createElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { WandSparklesIcon } from "@hugeicons/core-free-icons";
import {
  definePluginApp,
  experimental_ProviderModelPicker as ProviderModelPicker,
  useComposer,
  useComposerView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { DecisionSummary, rpcContract, ScopeOptions } from "./server";
import type { RotationEntry } from "./lib/router";
import { autoMode } from "@/lib/auto-mode";
import { findComposer } from "@/lib/composer-dom";
import { selectionFor } from "@/lib/fill";
import type { LiveFillSnapshot } from "@/lib/live-fill";
import { acquireSession, releaseSession, type Session } from "@/lib/session";
import { REASONING_LEVELS, type ReasoningLevel } from "@/lib/reasoning";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import "./app.css";

/** The server keeps its connection to Jev hot for a few minutes after each warm. */
const WARM_AT_MOST_EVERY_MS = 20_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useAutoMode(): boolean {
  return useSyncExternalStore(autoMode.subscribe, autoMode.get, () => false);
}

type WandState = "off" | "on" | "pending" | "error";

// The icon draws the stick first and then its two sparkles. They are rendered
// as separate parts here so that app.css can move each on its own.
const [WAND_STICK, ...WAND_SPARKLES] = WandSparklesIcon;
/** The tip of the wand, and where the motes that come off it fly to, in the icon's 24-unit box. */
const WAND_TIP = { x: 10, y: 11 };
const WAND_MOTES = [
  { dx: -6.5, dy: -1.5 },
  { dx: -5, dy: -5.5 },
  { dx: -1.5, dy: -7 },
];
/** Evenly spaced and equally bright, ending where it began so the sweep has no seam. */
const RAINBOW_HUES = [0, 60, 120, 180, 240, 300, 360];

/** One trip of the rainbow across the sparkles. Slow enough to be noticed only in passing. */
const RAINBOW_DRIFT = "24s";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeToReducedMotion(listener: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

function wandPart(
  element: (typeof WandSparklesIcon)[number],
  name: string,
  props: Record<string, unknown>,
) {
  // The icon's own keys are dropped: they would collide with the motes'.
  const [tag, { key: _key, ...attributes }] = element as [string, Record<string, unknown>];
  return createElement(tag, { ...attributes, ...props, key: name });
}

/**
 * The Auto toggle's icon, which is how it shows its state: a filled button
 * there would compete with send, the one filled control in that row. On, the
 * sparkles are lit with a rainbow that drifts slowly across them. `moment`
 * changes each time the wand should move, which restarts its animations:
 * `flick` turns the stick, `cast` pops the sparkles and sends motes off the tip.
 */
function AutoWand({
  state,
  moment,
  flick,
  cast,
}: {
  state: WandState;
  moment: number;
  flick: boolean;
  cast: boolean;
}) {
  const gradientId = `auto-dispatch-rainbow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const still = usePrefersReducedMotion();
  const lit = state === "on" || state === "pending";
  const rainbow = `url(#${gradientId})`;
  return (
    <svg
      key={moment}
      viewBox="0 0 24 24"
      fill="none"
      className={cn(
        COARSE_POINTER_ICON_SIZE_CLASS,
        "auto-dispatch-wand",
        state === "error" && "text-destructive",
      )}
      data-state={state}
      data-flick={flick ? "" : undefined}
      data-cast={cast ? "" : undefined}
      data-icon-root=""
      aria-hidden
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="24"
          y2="12"
          spreadMethod="repeat"
        >
          {RAINBOW_HUES.map((hue) => (
            <stop key={hue} offset={hue / 360} stopColor={`oklch(0.74 0.17 ${hue})`} />
          ))}
          {/* One full period of the gradient, so the loop has no jump. */}
          {!still && (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              from="0 0"
              to="24 12"
              dur={RAINBOW_DRIFT}
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>
      {WAND_STICK !== undefined && wandPart(WAND_STICK, "stick", { className: "stick" })}
      {WAND_SPARKLES.map((sparkle, index) =>
        wandPart(sparkle, `sparkle-${index}`, {
          className: "sparkle",
          ...(lit ? { fill: rainbow, stroke: rainbow } : {}),
        }),
      )}
      {WAND_MOTES.map((mote, index) => (
        <circle
          key={`mote-${index}`}
          className="mote"
          cx={WAND_TIP.x}
          cy={WAND_TIP.y}
          r="0.9"
          fill={lit ? rainbow : "currentColor"}
          style={{ "--dx": `${mote.dx}px`, "--dy": `${mote.dy}px` } as CSSProperties}
        />
      ))}
    </svg>
  );
}

const NO_SESSION: LiveFillSnapshot = { enabled: false, pending: false, error: null };
const getNoSession = () => NO_SESSION;
const getNoCasts = () => 0;
const subscribeToNothing = () => () => {};

/**
 * The Auto toggle, in the composer beside the send button. While it is on, Jev
 * is asked again as the draft changes and the composer's pickers follow. Send
 * waits until the pickers match the draft, so what runs is what was shown.
 */
function AutoToggle() {
  const enabled = useAutoMode();
  const composer = useComposer();
  const view = useComposerView();
  const rpc = useRpc<typeof rpcContract>();
  const anchor = useRef<HTMLSpanElement>(null);
  const [session, setSession] = useState<Session | null>(null);

  // BB rebuilds this button when the composer's project changes, which Auto
  // itself causes. The session belongs to the composer, so it carries on.
  useLayoutEffect(() => {
    const root = anchor.current === null ? null : findComposer(anchor.current);
    if (root === null) return;
    setSession(acquireSession(root));
    return () => releaseSession(root);
  }, []);

  useLayoutEffect(() => {
    session?.attach({
      route: async (text) => selectionFor((await rpc.call("preview", { text })).decision),
      setSelection: (selection) => composer.experimental_setSelection(selection),
    });
  }, [session, rpc, composer]);

  const text = view.draft.text;
  useEffect(() => session?.live.setEnabled(enabled), [session, enabled]);
  useEffect(() => session?.live.setText(text), [session, text]);

  // The first request on a cold connection takes a second or more, so the
  // server opens it, and refreshes what it knows about machines and projects,
  // before the first word is typed.
  const lastWarmAt = useRef(0);
  const warm = useCallback(() => {
    if (Date.now() - lastWarmAt.current < WARM_AT_MOST_EVERY_MS) return;
    lastWarmAt.current = Date.now();
    rpc.call("warm").catch(() => {});
  }, [rpc]);
  useEffect(() => {
    if (!enabled) return;
    warm();
    window.addEventListener("focus", warm);
    return () => window.removeEventListener("focus", warm);
  }, [enabled, warm]);

  const snapshot = useSyncExternalStore(
    session?.live.subscribe ?? subscribeToNothing,
    session?.live.getSnapshot ?? getNoSession,
  );

  // Auto moving the pickers makes the wand cast, though not for moves made
  // before this button was (re)built. A click flicks it, and casts if that
  // switched Auto on.
  const casts = useSyncExternalStore(
    session?.subscribeCasts ?? subscribeToNothing,
    session?.getCasts ?? getNoCasts,
  );
  const castsAtMount = useRef<number | null>(null);
  if (session !== null && castsAtMount.current === null) castsAtMount.current = casts;
  const moves = casts - (castsAtMount.current ?? casts);
  const [clicks, setClicks] = useState({ count: 0, atMoves: -1 });
  // The latest of the two is the one the wand is showing.
  const clickedLast = clicks.count > 0 && clicks.atMoves === moves;

  const state: WandState =
    snapshot.error !== null ? "error" : snapshot.pending ? "pending" : enabled ? "on" : "off";
  return (
    <span ref={anchor} className="contents">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
                // Pressed is drawn by the icon, not by the ghost button's fill.
                "aria-pressed:bg-transparent aria-pressed:hover:bg-state-hover",
                !enabled && "text-muted-foreground",
              )}
              aria-label="Auto"
              aria-pressed={enabled}
              // On the way to switching it on.
              onPointerEnter={warm}
              onFocus={warm}
              onClick={() => {
                setClicks((current) => ({ count: current.count + 1, atMoves: moves }));
                autoMode.set(!enabled);
              }}
            >
              <AutoWand
                state={state}
                moment={moves + clicks.count}
                flick={clickedLast}
                cast={clickedLast ? enabled : moves > 0}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {snapshot.error !== null
              ? `Auto: ${snapshot.error}`
              : enabled
                ? "Auto is on: Jev picks where this runs as you type"
                : "Auto: let Jev pick where this runs as you type"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

/** Which projects and environments Auto may use, saved as they change. */
function useScope() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<ScopeOptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc.call("scope_get").then(setState, (cause) => setError(errorMessage(cause)));
  }, [rpc]);

  // Each section saves only the fields it owns; the server merges them.
  const save = useCallback(
    (scope: Partial<ScopeOptions["scope"]>) => {
      setState((current) =>
        current === null ? current : { ...current, scope: { ...current.scope, ...scope } },
      );
      rpc.call("scope_set", { scope }).then(
        () => setError(null),
        (cause) => setError(errorMessage(cause)),
      );
    },
    [rpc],
  );
  return { state, error, save };
}

function OptionRow({
  name,
  detail,
  checked,
  disabled,
  onCheckedChange,
}: {
  name: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange(checked: boolean): void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-3 py-2 text-sm">
        <Checkbox
          className="mt-0.5"
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onCheckedChange(next === true)}
        />
        <span className="min-w-0">
          <span className="block font-medium text-foreground">{name}</span>
          {detail !== "" && (
            <span className="block truncate text-xs text-muted-foreground">{detail}</span>
          )}
        </span>
      </label>
    </li>
  );
}

function ProjectsSection() {
  const { state, error, save } = useScope();
  if (state === null) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>;
  }
  const { scope, projects } = state;
  const picked = new Set(scope.projectIds);
  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Switch
          checked={scope.allProjects}
          onCheckedChange={(allProjects) =>
            save({
              allProjects,
              // Start the list from everything, so narrowing is a matter of unchecking.
              projectIds:
                !allProjects && scope.projectIds.length === 0
                  ? projects.map((project) => project.id)
                  : scope.projectIds,
            })
          }
          aria-label="All projects"
        />
        <span className="font-medium text-foreground">All projects</span>
        <span className="text-muted-foreground">including ones you add later</span>
      </label>
      {!scope.allProjects && (
        <>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => save({ projectIds: projects.map((project) => project.id) })}
            >
              Select all
            </Button>
            <Button variant="outline" size="sm" onClick={() => save({ projectIds: [] })}>
              Clear
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {projects.map((project) => (
              <OptionRow
                key={project.id}
                name={project.name}
                detail={project.detail}
                checked={picked.has(project.id)}
                onCheckedChange={(checked) =>
                  save({
                    projectIds: checked
                      ? [...scope.projectIds, project.id]
                      : scope.projectIds.filter((id) => id !== project.id),
                  })
                }
              />
            ))}
          </ul>
          {picked.size === 0 && (
            <p className="text-sm text-destructive">Pick at least one project for Auto to use.</p>
          )}
        </>
      )}
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function EnvironmentsSection() {
  const { state, error, save } = useScope();
  if (state === null) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>;
  }
  const { scope, environments } = state;
  const picked = new Set(scope.environmentIds);
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border">
        {environments.map((environment) => (
          <OptionRow
            key={environment.id}
            name={environment.name}
            detail={environment.detail}
            checked={picked.has(environment.id)}
            // Auto always needs somewhere to run.
            disabled={picked.has(environment.id) && picked.size === 1}
            onCheckedChange={(checked) =>
              save({
                // Kept in the order listed, which is the order of preference.
                environmentIds: environments
                  .map((entry) => entry.id)
                  .filter((id) => (id === environment.id ? checked : picked.has(id))),
              })
            }
          />
        ))}
      </ul>
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

const EFFORT_DETAILS: Record<ReasoningLevel, string> = {
  none: "No extended reasoning.",
  low: "",
  medium: "",
  high: "",
  xhigh: "",
  max: "The most a model will think.",
  ultra: "A special run mode on some providers. Costs far more than a reasoning level.",
  ultracode: "Claude Code's multi-agent run mode. Costs far more than a reasoning level.",
};

function EffortSection() {
  const { state, error, save } = useScope();
  if (state === null) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>;
  }
  const picked = new Set(state.scope.reasoningLevels);
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border">
        {REASONING_LEVELS.map((level) => (
          <OptionRow
            key={level}
            name={level}
            detail={EFFORT_DETAILS[level]}
            checked={picked.has(level)}
            // Auto always needs some effort to run at.
            disabled={picked.has(level) && picked.size === 1}
            onCheckedChange={(checked) =>
              save({
                reasoningLevels: REASONING_LEVELS.filter((entry) =>
                  entry === level ? checked : picked.has(entry),
                ),
              })
            }
          />
        ))}
      </ul>
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function RotationRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: RotationEntry;
  onChange(next: RotationEntry): void;
  onRemove(): void;
}) {
  // Typing saves on blur, so a half-written note never reaches the server.
  const [note, setNote] = useState(entry.note);
  useEffect(() => setNote(entry.note), [entry.note]);
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <ProviderModelPicker
        value={{
          providerId: entry.providerId,
          model: entry.model,
          reasoningLevel: entry.reasoningLevel,
        }}
        onChange={(value) =>
          onChange({
            ...entry,
            providerId: value.providerId,
            model: value.model,
            reasoningLevel: value.reasoningLevel,
          })
        }
      />
      <Input
        className="min-w-48 flex-1"
        value={note}
        maxLength={600}
        placeholder="When to use it, e.g. “UI design and planning”"
        aria-label="When to use this model"
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => {
          if (note !== entry.note) onChange({ ...entry, note });
        }}
      />
      <Button variant="ghost" size="icon" aria-label="Remove model" onClick={onRemove}>
        <Icon name="Trash2" className="size-4" />
      </Button>
    </li>
  );
}

function RotationSection() {
  const rpc = useRpc<typeof rpcContract>();
  const [entries, setEntries] = useState<RotationEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc.call("rotation_get").then(
      (result) => setEntries(result.entries),
      (cause) => setError(errorMessage(cause)),
    );
  }, [rpc]);

  const save = useCallback(
    (next: RotationEntry[]) => {
      setEntries(next);
      rpc.call("rotation_set", { entries: next }).then(
        () => setError(null),
        (cause) => setError(errorMessage(cause)),
      );
    },
    [rpc],
  );

  const add = useCallback(async () => {
    try {
      const { seed } = await rpc.call("rotation_seed");
      if (seed === null) {
        setError("No agent provider is available to pick a model from.");
        return;
      }
      save([...(entries ?? []), seed]);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [rpc, entries, save]);

  if (entries === null) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>;
  }
  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No models yet. Auto needs at least one to choose from.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((entry, index) => (
            <RotationRow
              key={index}
              entry={entry}
              onChange={(next) => save(entries.map((current, i) => (i === index ? next : current)))}
              onRemove={() => save(entries.filter((_, i) => i !== index))}
            />
          ))}
        </ul>
      )}
      <Button variant="outline" size="sm" onClick={() => void add()}>
        <Icon name="Plus" className="size-4" />
        Add model
      </Button>
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function percent(value: number | null): string {
  return value === null ? "" : `${Math.round(value * 100)}%`;
}

function DecisionRow({
  title,
  pick,
}: {
  title: string;
  pick: DecisionSummary["reasoning"];
}) {
  const others = pick.alternatives.filter((alternative) => alternative.probability >= 0.05);
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{title}</dt>
      <dd className="min-w-0">
        <span className="font-medium text-foreground">{pick.label}</span>{" "}
        <span className="text-muted-foreground">
          {pick.source === "only-option"
            ? "only option"
            : `${percent(pick.probability)}${pick.source === "fallback" ? " fallback" : ""}`}
        </span>
        {others.length > 0 && (
          <div className="truncate text-xs text-muted-foreground">
            also {others.map((other) => `${other.label} ${percent(other.probability)}`).join(", ")}
          </div>
        )}
      </dd>
    </div>
  );
}

function TrySection() {
  const rpc = useRpc<typeof rpcContract>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<DecisionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setDecision((await rpc.call("preview", { text })).decision);
    } catch (cause) {
      setDecision(null);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        rows={3}
        placeholder="Fix the crash when the iOS app opens a deep link…"
        aria-label="Prompt to route"
        onChange={(event) => setText(event.target.value)}
      />
      <Button size="sm" disabled={busy || text.trim() === ""} onClick={() => void run()}>
        {busy ? "Routing…" : "Route it"}
      </Button>
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      {decision !== null && (
        <dl className="divide-y divide-border rounded-md border border-border px-3">
          <DecisionRow title="Project" pick={decision.project} />
          <DecisionRow title="Machine" pick={decision.machine} />
          <DecisionRow title="Model" pick={decision.model} />
          <DecisionRow title="Reasoning" pick={decision.reasoning} />
          <DecisionRow title="Environment" pick={decision.environment} />
          <div className="py-1.5 text-xs text-muted-foreground">
            Decided in {decision.latencyMs}ms
          </div>
        </dl>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "auto",
    scopes: ["new-thread"],
    actions: [{ id: "toggle", component: AutoToggle }],
  });
  app.slots.settingsSection({
    id: "projects",
    title: "Projects",
    description: "The projects Auto may choose between.",
    component: ProjectsSection,
  });
  app.slots.settingsSection({
    id: "environments",
    title: "Environments",
    description:
      "Where a dispatched thread works. With one checked, Auto always uses it. With several, Jev picks one per prompt. A project that none of them can serve, such as one that is not a git repository, falls back to Project checkout.",
    component: EnvironmentsSection,
  });
  app.slots.settingsSection({
    id: "rotation",
    title: "Model rotation",
    description:
      "The models Auto may pick, each with a note on when to use it. You add models, not model-and-effort pairs: Jev picks the effort for each prompt from the levels that model supports and you allow below. The effort shown on a row is ignored unless the model offers no choice.",
    component: RotationSection,
  });
  app.slots.settingsSection({
    id: "effort",
    title: "Effort levels",
    description:
      "The reasoning efforts Auto may pick. Jev only chooses among the checked levels a model supports, and an unchecked level is never used. Ultra and ultracode are off unless you turn them on.",
    component: EffortSection,
  });
  app.slots.settingsSection({
    id: "try",
    title: "Try it",
    description: "See where a prompt would go. Nothing is started.",
    component: TrySection,
  });
});
