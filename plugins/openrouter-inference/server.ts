// OpenRouter Inference — serves BB's helper completions (thread titles and
// commit messages) and voice transcription with an OpenRouter API key and
// models picked in settings. BB 0.44 runs both functions in this process, so
// the key never leaves the server.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  DEFAULT_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  SERVICE_ID,
  serviceKindSchema,
  TASKS,
  type ServiceConfig,
  type ServiceKind,
} from "./contract.js";
import {
  completeWithOpenRouter,
  fetchOpenRouterModels,
  REQUEST_TIMEOUT_MS,
  transcribeWithOpenRouter,
  type AudioUpload,
  type OpenRouterModel,
} from "./openrouter.js";
import { TEST_CLIP } from "./test-audio.js";

const MODEL_CACHE_MS = 10 * 60_000;
const STATE_CHANGED = "state-changed";
const NOT_CONFIGURED = "Add an OpenRouter API key in the OpenRouter Inference plugin settings.";

const TEST_TITLE_PROMPT =
  'Write a short title (at most 6 words) for a coding thread that starts with: "Add an OpenRouter plugin that generates thread titles and commit messages."';

const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextLength: z.number().nullable(),
  promptPrice: z.number().nullable(),
  completionPrice: z.number().nullable(),
});
export type ModelOption = z.infer<typeof modelSchema>;

/** What BB currently routes one kind to, and whether that is this plugin. */
const selectionSchema = z
  .object({
    mode: z.enum(["automatic", "off", "service"]),
    /** The selected service's id, when `mode` is "service". */
    serviceId: z.string().nullable(),
    selected: z.boolean(),
  })
  .strict();
export type Selection = z.infer<typeof selectionSchema>;

const statusSchema = z.object({
  hasApiKey: z.boolean(),
  model: z.string(),
  transcriptionModel: z.string(),
  selection: z.object({ inference: selectionSchema, voice: selectionSchema }).strict(),
  /** Why BB would refuse this service, or null when it is ready. */
  serviceMessage: z.string().nullable(),
});
export type Status = z.infer<typeof statusSchema>;

export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: statusSchema },
  models: {
    input: z.object({ kind: serviceKindSchema, refresh: z.boolean() }).strict(),
    output: z.object({ models: z.array(modelSchema) }),
  },
  setModel: {
    input: z.object({ kind: serviceKindSchema, model: z.string().trim().min(1).max(200) }).strict(),
    output: z.object({ model: z.string() }),
  },
  useFor: {
    input: z.object({ kind: serviceKindSchema }).strict(),
    output: z.object({ selection: selectionSchema }),
  },
  test: {
    input: z.object({ kind: serviceKindSchema }).strict(),
    output: z.object({
      text: z.string(),
      model: z.string(),
      durationMs: z.number(),
    }),
  },
});

/** Base64-encode the audio BB hands to `transcribe`, keeping its name and MIME type. */
async function audioUpload(audio: File): Promise<AudioUpload> {
  return {
    base64: Buffer.from(await audio.arrayBuffer()).toString("base64"),
    filename: audio.name,
    mimeType: audio.type,
  };
}

export default async function plugin(bb: BbPluginApi) {
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
      description: "OpenRouter model id for titles and commit messages. Pick one from the list below.",
      experimental_schema: z.string().trim().min(1).max(200),
      default: DEFAULT_MODEL,
    },
    transcriptionModel: {
      type: "string",
      label: "Transcription model",
      description: "OpenRouter speech-to-text model id for voice input. Pick one from the list below.",
      experimental_schema: z.string().trim().min(1).max(200),
      default: DEFAULT_TRANSCRIPTION_MODEL,
    },
  });

  const modelCaches = new Map<ServiceKind, { models: OpenRouterModel[]; fetchedAt: number }>();
  async function listModels(kind: ServiceKind, refresh: boolean): Promise<OpenRouterModel[]> {
    const cached = modelCaches.get(kind);
    if (!refresh && cached && Date.now() - cached.fetchedAt < MODEL_CACHE_MS) {
      return cached.models;
    }
    const models = await fetchOpenRouterModels(kind, AbortSignal.timeout(15_000));
    modelCaches.set(kind, { models, fetchedAt: Date.now() });
    return models;
  }

  /** The key and models every request uses, or null while the key is missing. */
  async function buildConfig(): Promise<ServiceConfig | null> {
    const { apiKey, model, transcriptionModel } = await settings.get();
    if (typeof apiKey !== "string" || apiKey.trim() === "") return null;
    let reasoning: ServiceConfig["reasoning"] = null;
    try {
      reasoning = (await listModels("inference", false)).find((entry) => entry.id === model)?.reasoning ?? null;
    } catch (error) {
      bb.log.warn(`model catalog unavailable; sending no reasoning override: ${messageOf(error)}`);
    }
    return { apiKey: apiKey.trim(), model, reasoning, transcriptionModel };
  }

  async function requireConfig(): Promise<ServiceConfig> {
    const config = await buildConfig();
    if (config === null) throw new Error(NOT_CONFIGURED);
    return config;
  }

  /** One sample title or one sample transcript, with the models now in settings. */
  async function runTest(kind: ServiceKind): Promise<{ text: string; model: string; durationMs: number }> {
    const config = await requireConfig();
    const startedAt = Date.now();
    if (kind === "voice") {
      const text = await transcribeWithOpenRouter(
        {
          base64: TEST_CLIP.base64,
          filename: TEST_CLIP.filename,
          mimeType: TEST_CLIP.mimeType,
        },
        config,
        new AbortController().signal,
        null,
        REQUEST_TIMEOUT_MS,
      );
      return { text, model: config.transcriptionModel, durationMs: Date.now() - startedAt };
    }
    const text = await completeWithOpenRouter(TEST_TITLE_PROMPT, config, new AbortController().signal);
    return { text, model: config.model, durationMs: Date.now() - startedAt };
  }

  bb.experimental_aiServices.register({
    id: SERVICE_ID,
    displayName: "OpenRouter (API key)",
    status: async () => {
      const { apiKey } = await settings.get();
      return typeof apiKey === "string" && apiKey.trim() !== ""
        ? { ready: true }
        : { ready: false, message: NOT_CONFIGURED };
    },
    complete: async (prompt, { signal }) => completeWithOpenRouter(prompt, await requireConfig(), signal),
    transcribe: async (audio, { signal, hint }) =>
      transcribeWithOpenRouter(await audioUpload(audio), await requireConfig(), signal, hint),
  });

  // The settings UI shows what BB routes each kind to, so refresh it on change.
  settings.onChange(() => bb.realtime.publish(STATE_CHANGED, {}));

  /** Read BB's current selection for one kind, and whether it points at this plugin. */
  async function selectionFor(kind: ServiceKind): Promise<Selection> {
    const { selections, services } = await bb.sdk.system.aiServices();
    const tasks = TASKS[kind];
    const mine = services.filter(
      (service) => service.id === SERVICE_ID && tasks.every((task) => service.tasks.includes(task)),
    );
    const chosen = selections[tasks[0]];
    const pointsHere = (task: (typeof tasks)[number]) => {
      const entry = selections[task];
      return entry.mode === "service" && entry.serviceId === SERVICE_ID;
    };
    const selected = mine.length > 0 && tasks.every(pointsHere);
    if (chosen.mode !== "service") return { mode: chosen.mode, serviceId: null, selected };
    return { mode: "service", serviceId: chosen.serviceId, selected };
  }

  bb.rpc.register(rpcContract, {
    status: async () => {
      const { apiKey, model, transcriptionModel } = await settings.get();
      const { services } = await bb.sdk.system.aiServices();
      const service = services.find((entry) => entry.id === SERVICE_ID);
      return {
        hasApiKey: typeof apiKey === "string" && apiKey.trim() !== "",
        model,
        transcriptionModel,
        selection: { inference: await selectionFor("inference"), voice: await selectionFor("voice") },
        serviceMessage: service && !service.status.ready ? service.status.message : null,
      };
    },
    models: async ({ kind, refresh }) => ({
      models: (await listModels(kind, refresh)).map(({ reasoning: _reasoning, ...model }) => model),
    }),
    setModel: async ({ kind, model }) => {
      const next =
        kind === "voice"
          ? await settings.experimental_set({ transcriptionModel: model })
          : await settings.experimental_set({ model });
      return { model: kind === "voice" ? next.transcriptionModel : next.model };
    },
    useFor: async ({ kind }) => {
      // Titles and commit messages are separate BB tasks; the inference kind
      // takes both.
      for (const task of TASKS[kind]) {
        await bb.sdk.system.setAiServiceSelection({
          task,
          selection: { mode: "service", pluginId: bb.pluginId, serviceId: SERVICE_ID },
        });
      }
      bb.realtime.publish(STATE_CHANGED, {});
      return { selection: await selectionFor(kind) };
    },
    test: ({ kind }) => runTest(kind),
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
