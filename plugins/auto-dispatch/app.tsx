// Auto Dispatch frontend: the Auto toggle above the New thread composer, and
// the plugin's settings sections: which projects and environments Auto may
// choose between, the model rotation, and a routing test.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  experimental_ProviderModelPicker as ProviderModelPicker,
  UrlLink,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { DecisionSummary, rpcContract, ScopeOptions } from "./server";
import type { RotationEntry } from "./lib/router";
import { autoMode } from "@/lib/auto-mode";
import { AUTO_ATTRIBUTE, interceptSubmit, watchRootComposer } from "@/lib/composer-dom";
import { buildDispatchPayload, parseStoredDraft, ROOT_DRAFT_STORAGE_KEY } from "@/lib/draft";
import { REASONING_LEVELS, type ReasoningLevel } from "@/lib/reasoning";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import "./app.css";

const SETTINGS_PATH = "/settings/plugins/auto-dispatch";
/** The server keeps its connection to Jev hot for a few minutes after each warm. */
const WARM_AT_MOST_EVERY_MS = 20_000;
const ROUTING_EFFECT = { className: "auto-dispatch-routing" };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useAutoMode(): boolean {
  return useSyncExternalStore(autoMode.subscribe, autoMode.get, () => false);
}

function decisionLine(decision: DecisionSummary): string {
  return [
    decision.project.label,
    decision.machine.label,
    decision.model.label,
    decision.reasoning.label,
    decision.environment.label,
  ].join(" · ");
}

function AutoBanner() {
  const enabled = useAutoMode();
  const composer = useComposer();
  const view = useComposerView();
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const marker = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [routing, setRouting] = useState(false);
  const [setup, setSetup] = useState<{ hasApiKey: boolean; rotationSize: number } | null>(null);

  // Auto only takes over the root New thread screen; composers that other
  // plugins embed keep their own submit.
  useLayoutEffect(() => {
    if (marker.current === null) return;
    return watchRootComposer(marker.current, setRoot);
  }, []);

  useLayoutEffect(() => {
    if (root === null || !enabled) return;
    root.setAttribute(AUTO_ATTRIBUTE, "on");
    return () => root.removeAttribute(AUTO_ATTRIBUTE);
  }, [root, enabled]);

  useEffect(() => {
    if (root === null || !enabled) return;
    let cancelled = false;
    rpc.call("status").then(
      (status) => {
        if (!cancelled) setSetup(status);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [root, enabled, rpc]);

  // Get the server ready while the prompt is still being written: it opens
  // its connection to Jev and refreshes what it knows about machines and
  // projects, so pressing Enter costs one round trip.
  const lastWarmAt = useRef(0);
  const warm = useCallback(() => {
    if (Date.now() - lastWarmAt.current < WARM_AT_MOST_EVERY_MS) return;
    lastWarmAt.current = Date.now();
    rpc.call("warm").catch(() => {});
  }, [rpc]);
  const composing = !view.draft.isEmpty;
  const draftText = view.draft.text;
  useEffect(() => {
    if (root === null || !enabled) return;
    warm();
    window.addEventListener("focus", warm);
    return () => window.removeEventListener("focus", warm);
  }, [root, enabled, warm]);
  useEffect(() => {
    if (root !== null && enabled && composing) warm();
  }, [root, enabled, composing, draftText, warm]);

  // The interceptor outlives renders, so it reads the latest state from a ref.
  const latest = useRef({ composer, view });
  latest.current = { composer, view };
  // A touch send arrives as pointerup and then click, faster than a render.
  const inFlight = useRef(false);

  const dispatch = useCallback(async () => {
    const current = latest.current;
    if (inFlight.current) return;
    const stored = parseStoredDraft(window.localStorage.getItem(ROOT_DRAFT_STORAGE_KEY));
    const payload = buildDispatchPayload(current.composer.text, stored);
    if (payload.text === "") return;
    if (payload.attachments.length !== current.view.draft.attachmentCount) {
      toast.error("Auto could not read this draft's attachments. Turn Auto off to send them.");
      return;
    }
    const scope = current.view.scope;
    inFlight.current = true;
    setRouting(true);
    current.composer.setInputLock(true);
    current.composer.setTextEffect(ROUTING_EFFECT);
    try {
      const { threadId, decision } = await rpc.call("dispatch", {
        ...payload,
        attachmentProjectId: scope.kind === "new-thread" ? scope.projectId : null,
      });
      latest.current.composer.clear();
      if (payload.attachments.length > 0) {
        // `clear()` keeps attachments, and BB re-saves the draft as this screen
        // unmounts. Drop the sent attachments once that has happened.
        window.setTimeout(() => window.localStorage.removeItem(ROOT_DRAFT_STORAGE_KEY), 750);
      }
      toast.success(`Auto → ${decisionLine(decision)}`);
      navigate.toThread(threadId);
    } catch (error) {
      toast.error(`Auto dispatch failed: ${errorMessage(error)}`);
    } finally {
      latest.current.composer.setTextEffect(null);
      latest.current.composer.setInputLock(false);
      inFlight.current = false;
      setRouting(false);
    }
  }, [rpc, navigate]);

  useEffect(() => {
    if (root === null || !enabled) return;
    return interceptSubmit(root, () => void dispatch());
  }, [root, enabled, dispatch]);

  if (root === null) return <div ref={marker} hidden />;

  const needsSetup = setup !== null && (!setup.hasApiKey || setup.rotationSize === 0);
  return (
    <div ref={marker} className="flex min-h-6 items-center gap-2 px-1 text-xs text-muted-foreground">
      <label className="flex cursor-pointer items-center gap-2">
        <Switch
          checked={enabled}
          disabled={routing}
          onCheckedChange={autoMode.set}
          aria-label="Auto dispatch"
        />
        <span className="font-medium text-foreground">Auto</span>
      </label>
      {enabled && routing && <span aria-live="polite">Routing…</span>}
      {enabled && !routing && needsSetup && (
        <span>
          {setup.hasApiKey ? "Add a model to the rotation" : "Add a Jev API key"} in{" "}
          <UrlLink href={SETTINGS_PATH} className="underline underline-offset-2 hover:text-foreground">
            settings
          </UrlLink>{" "}
          to use Auto.
        </span>
      )}
    </div>
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
    banners: [{ id: "toggle", chrome: "bare", component: AutoBanner }],
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
