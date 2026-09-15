import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ServiceKind } from "./contract";
import type { ModelOption, rpcContract, Status } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_MODELS = 200;

const SERVICES: Record<
  ServiceKind,
  { label: string; useLabel: string; limitMs: number; slowNote: string; showPricing: boolean }
> = {
  inference: {
    label: "Titles & commit messages",
    useLabel: "Use for titles & commit messages",
    /** BB's per-attempt budget for title and commit-message inference. */
    limitMs: 5_000,
    slowNote: "slower than BB's 5s limit for titles",
    showPricing: true,
  },
  voice: {
    label: "Voice transcription",
    useLabel: "Use for voice transcription",
    /** BB's per-attempt budget for voice transcription. */
    limitMs: 10_000,
    slowNote: "slower than BB's 10s limit for voice input",
    // Speech-to-text prices mix per-token, per-second, and per-minute units.
    showPricing: false,
  },
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatPrice(model: ModelOption): string {
  if (model.promptPrice === null || model.completionPrice === null) return "variable price";
  if (model.promptPrice === 0 && model.completionPrice === 0) return "free";
  // Two decimals, or three for sub-dime prices like $0.075.
  const format = (value: number) => `$${value < 0.1 ? value.toFixed(3).replace(/(\.\d\d\d*?)0+$/u, "$1") : value.toFixed(2)}`;
  return `${format(model.promptPrice)} in · ${format(model.completionPrice)} out /1M`;
}

function formatContext(tokens: number | null): string | null {
  if (tokens === null) return null;
  return tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M ctx` : `${Math.round(tokens / 1000)}K ctx`;
}

function ServiceSettings({ kind }: { kind: ServiceKind }) {
  const service = SERVICES[kind];
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<Status | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    rpc.call("status").then(setStatus, (cause) => toast.error(messageOf(cause)));
  }, [rpc]);

  const loadModels = useCallback(
    (refresh: boolean) => {
      setModelError(null);
      rpc.call("models", { kind, refresh }).then(
        (result) => setModels(result.models),
        (cause) => setModelError(messageOf(cause)),
      );
    },
    [rpc, kind],
  );

  useEffect(() => {
    refreshStatus();
    loadModels(false);
  }, [refreshStatus, loadModels]);
  useRealtime("state-changed", refreshStatus);

  const filtered = useMemo(() => {
    if (models === null) return [];
    const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
    return models.filter((model) => {
      const haystack = `${model.name} ${model.id}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [models, query]);

  async function run(label: string, action: () => Promise<void>) {
    setPending(label);
    try {
      await action();
    } catch (cause) {
      toast.error(messageOf(cause));
    } finally {
      setPending(null);
      refreshStatus();
    }
  }

  const selectModel = (model: ModelOption) =>
    run("select", async () => {
      await rpc.call("setModel", { kind, model: model.id });
      setTestResult(null);
      toast.success(`Using ${model.name} for ${service.label.toLowerCase()}`);
    });

  const selectedId = kind === "voice" ? status?.transcriptionModel : status?.model;
  const current = kind === "voice" ? status?.transcription : status?.inference;
  const active = status !== null && current === status.serviceValue;
  const selected = models?.find((model) => model.id === selectedId);

  return (
    <div role="region" aria-label={service.label} className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <StatusRow ok={status?.hasApiKey === true} label="API key">
          {status === null ? "Loading…" : status.hasApiKey ? "Saved" : "Add your key in the field above"}
        </StatusRow>
        <StatusRow ok={status !== null} label="Model">
          <span className="font-mono">{selectedId ?? "…"}</span>
          {selected ? <span className="text-muted-foreground"> · {selected.name}</span> : null}
        </StatusRow>
        <StatusRow ok={active} label={service.label}>
          {current === undefined ? (
            "…"
          ) : active ? (
            "Served by this plugin"
          ) : (
            <>
              Currently <span className="font-mono">{current}</span>
            </>
          )}
        </StatusRow>
        {status?.hostError ? (
          <p role="alert" className="text-destructive">
            Could not sync the key to the host: {status.hostError}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {!active ? (
            <Button
              disabled={pending !== null || status?.hasApiKey !== true}
              onClick={() =>
                run("use", async () => {
                  const result = await rpc.call("useFor", { kind });
                  toast.success(`Now using ${result.value} for ${service.label.toLowerCase()}`);
                })
              }
            >
              <Icon name="Zap" className="size-4" />
              {service.useLabel}
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={pending !== null || status?.hasApiKey !== true}
            onClick={() =>
              run("test", async () => {
                setTestResult(null);
                const result = await rpc.call("test", { kind });
                const slow = result.durationMs > service.limitMs ? `, ${service.slowNote}` : "";
                const text = result.text === "" ? "No text" : `“${result.text}”`;
                setTestResult(`${text} from ${result.model} in ${result.durationMs}ms${slow}`);
              })
            }
          >
            <Icon name={pending === "test" ? "Loading" : "Target"} className={cn("size-4", pending === "test" && "animate-spin")} />
            Test
          </Button>
          {testResult ? <span className="text-muted-foreground">{testResult}</span> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon
              name="Search"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models by name or id"
              aria-label="Search models"
              className="pl-8"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh model list"
            disabled={models === null && modelError === null}
            onClick={() => {
              setModels(null);
              loadModels(true);
            }}
          >
            <Icon name="RotateCcw" className="size-4" />
          </Button>
        </div>
        {modelError ? (
          <p role="alert" className="text-destructive">
            {modelError}
          </p>
        ) : models === null ? (
          <p className="text-muted-foreground">Loading OpenRouter models…</p>
        ) : (
          <>
            <ul
              role="listbox"
              aria-label={`OpenRouter ${kind === "voice" ? "speech-to-text " : ""}models`}
              className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card"
            >
              {filtered.slice(0, MAX_VISIBLE_MODELS).map((model) => {
                const isSelected = model.id === selectedId;
                return (
                  <li key={model.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => {
                        if (!isSelected) void selectModel(model);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent disabled:cursor-default",
                        isSelected && "bg-accent",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{model.name}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">{model.id}</div>
                      </div>
                      {service.showPricing ? (
                        <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                          <div>{formatPrice(model)}</div>
                          <div>{formatContext(model.contextLength)}</div>
                        </div>
                      ) : null}
                      {isSelected ? <Icon name="Check" className="size-4 shrink-0" /> : null}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-muted-foreground">No models match “{query}”.</li>
              ) : null}
            </ul>
            <p className="text-xs text-muted-foreground">
              {filtered.length > MAX_VISIBLE_MODELS
                ? `Showing ${MAX_VISIBLE_MODELS} of ${filtered.length} matches. Refine your search to see more.`
                : `${filtered.length} of ${models.length} models`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function StatusRow({ ok, label, children }: { ok: boolean; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon
        name={ok ? "CircleCheck" : "Circle"}
        className={cn("mt-0.5 size-4 shrink-0", ok ? "text-primary" : "text-muted-foreground")}
      />
      <div className="min-w-0">
        <span className="font-medium">{label}: </span>
        {children}
      </div>
    </div>
  );
}

function InferenceSettings() {
  return <ServiceSettings kind="inference" />;
}

function VoiceSettings() {
  return <ServiceSettings kind="voice" />;
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "openrouter",
    title: "Titles & commit messages",
    description: "Pick the OpenRouter model BB uses for thread titles and commit messages.",
    component: InferenceSettings,
  });
  app.slots.settingsSection({
    id: "openrouter-voice",
    title: "Voice transcription",
    description: "Pick the OpenRouter speech-to-text model BB uses for voice input.",
    component: VoiceSettings,
  });
});
