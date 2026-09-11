// OpenRouter Inference — serves BB's helper completions (thread titles and
// commit messages) with an OpenRouter API key and a model picked in settings.
import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  hostContract,
  INFERENCE_SETTING_VALUE,
  SERVICE_ID,
  type HostConfig,
} from "./contract.js";
import { fetchOpenRouterModels, type OpenRouterModel } from "./openrouter.js";

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const MODEL_CACHE_MS = 10 * 60_000;
const STATE_CHANGED = "state-changed";

const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextLength: z.number().nullable(),
  promptPrice: z.number().nullable(),
  completionPrice: z.number().nullable(),
});
export type ModelOption = z.infer<typeof modelSchema>;

const statusSchema = z.object({
  hasApiKey: z.boolean(),
  model: z.string(),
  /** The running server's BB_INFERENCE. */
  inference: z.string(),
  inferenceValue: z.string(),
  hostError: z.string().nullable(),
});
export type Status = z.infer<typeof statusSchema>;

export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: statusSchema },
  models: {
    input: z.object({ refresh: z.boolean() }).strict(),
    output: z.object({ models: z.array(modelSchema) }),
  },
  setModel: {
    input: z.object({ model: z.string().trim().min(1).max(200) }).strict(),
    output: z.object({ model: z.string() }),
  },
  useForInference: {
    input: z.null(),
    output: z.object({ inference: z.string() }),
  },
  test: {
    input: z.null(),
    output: z.object({
      title: z.string(),
      model: z.string(),
      durationMs: z.number(),
    }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.experimental_aiServices.register({
    id: SERVICE_ID,
    displayName: "OpenRouter (API key)",
    kinds: ["inference"],
  });

  const settings = bb.settings.define({
    apiKey: {
      type: "string",
      label: "OpenRouter API key",
      description: "Create one at https://openrouter.ai/keys.",
      secret: true,
    },
    model: {
      type: "string",
      label: "Model",
      description: "OpenRouter model id. Pick one from the list below.",
      experimental_schema: z.string().trim().min(1).max(200),
      default: DEFAULT_MODEL,
    },
  });

  const host = bb.hosts.experimental_client({ contract: hostContract });

  let modelCache: { models: OpenRouterModel[]; fetchedAt: number } | null = null;
  async function listModels(refresh: boolean): Promise<OpenRouterModel[]> {
    if (!refresh && modelCache && Date.now() - modelCache.fetchedAt < MODEL_CACHE_MS) {
      return modelCache.models;
    }
    const models = await fetchOpenRouterModels(AbortSignal.timeout(15_000));
    modelCache = { models, fetchedAt: Date.now() };
    return models;
  }

  async function buildHostConfig(): Promise<HostConfig | null> {
    const { apiKey, model } = await settings.get();
    if (typeof apiKey !== "string" || apiKey.trim() === "") return null;
    let reasoning: HostConfig["reasoning"] = null;
    try {
      reasoning = (await listModels(false)).find((entry) => entry.id === model)?.reasoning ?? null;
    } catch (error) {
      bb.log.warn(`model catalog unavailable; sending no reasoning override: ${messageOf(error)}`);
    }
    return { apiKey: apiKey.trim(), model, reasoning };
  }

  // Mirrors core's primary-host resolution: helper inference always runs there.
  async function primaryHostId(): Promise<string> {
    try {
      const id = (await readFile(join(bb.server.experimental_dataDir, "host-id"), "utf8")).trim();
      if (id !== "") return id;
    } catch {
      // Fall through to the enrolled hosts.
    }
    const hosts = await bb.sdk.hosts.list();
    const connected = hosts.filter((entry) => entry.status === "connected");
    const only = connected.length === 1 ? connected[0] : hosts.length === 1 ? hosts[0] : undefined;
    if (!only) throw new Error("Could not determine the primary host");
    return only.id;
  }

  let hostError: string | null = null;
  let requestSync = () => {};

  // Keep the primary host's copy of the key and model current. Retries with
  // backoff while the host is offline; settings changes wake it immediately.
  bb.background.service("host-sync", {
    async start(signal) {
      let dirty = true;
      let failures = 0;
      let wake: (() => void) | null = null;
      requestSync = () => {
        dirty = true;
        wake?.();
      };
      while (!signal.aborted) {
        if (dirty) {
          dirty = false;
          try {
            const hostId = await primaryHostId();
            await host.call("configure", { config: await buildHostConfig() }, { hostId, signal });
            hostError = null;
            failures = 0;
          } catch (error) {
            if (signal.aborted) break;
            hostError = messageOf(error);
            bb.log.warn(`host sync failed: ${hostError}`);
            failures += 1;
          }
          bb.realtime.publish(STATE_CHANGED, {});
        }
        // A settings change during the sync already marked it dirty again.
        if (dirty) continue;
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            wake = null;
            resolve();
          };
          const timer =
            failures > 0 ? setTimeout(done, Math.min(5_000 * 2 ** (failures - 1), 60_000)) : undefined;
          wake = done;
          signal.addEventListener("abort", done, { once: true });
        });
        if (failures > 0) dirty = true;
      }
    },
  });

  settings.onChange(() => requestSync());

  // BB_INFERENCE lives in BB's managed config.json. Write it the way the
  // bb-app launcher does (merge, temp file, rename), then reload the server.
  async function useForInference(): Promise<string> {
    const dataDir = bb.server.experimental_dataDir;
    const configPath = join(dataDir, "config.json");
    let current: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${configPath} is not a JSON object`);
      }
      current = parsed as Record<string, unknown>;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const managed = current.config;
    const next = {
      ...current,
      config: {
        ...(managed !== null && typeof managed === "object" ? managed : {}),
        BB_INFERENCE: INFERENCE_SETTING_VALUE,
      },
    };
    const tempPath = join(dataDir, `.config.json.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(tempPath, configPath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
    await bb.sdk.system.reloadConfig();
    return (await bb.sdk.system.config()).aiServices.inference;
  }

  bb.rpc.register(rpcContract, {
    status: async () => {
      const { apiKey, model } = await settings.get();
      const { aiServices } = await bb.sdk.system.config();
      return {
        hasApiKey: typeof apiKey === "string" && apiKey.trim() !== "",
        model,
        inference: aiServices.inference,
        inferenceValue: INFERENCE_SETTING_VALUE,
        hostError,
      };
    },
    models: async ({ refresh }) => ({
      models: (await listModels(refresh)).map(({ reasoning: _reasoning, ...model }) => model),
    }),
    setModel: async ({ model }) => {
      const next = await settings.experimental_set({ model });
      return { model: next.model };
    },
    useForInference: async () => {
      const inference = await useForInference();
      bb.realtime.publish(STATE_CHANGED, {});
      return { inference };
    },
    test: async () => {
      const hostId = await primaryHostId();
      await host.call("configure", { config: await buildHostConfig() }, { hostId });
      const result = await host.call("test", null, { hostId, timeoutMs: 25_000 });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      return { title: result.title, model: result.model, durationMs: result.durationMs };
    },
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
