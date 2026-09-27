// OpenRouter HTTP helpers. Everything here is plain fetch plus pure functions;
// BB 0.44 calls these from the plugin's server process, so no host tunnel is
// involved.
import { z } from "zod";
import type { ReasoningParam, ServiceConfig, ServiceKind } from "./contract.js";

export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

/** BB stops waiting after 5s (titles) or 10s (voice); this is our own ceiling. */
export const REQUEST_TIMEOUT_MS = 20_000;

const REQUEST_HEADERS = {
  "HTTP-Referer": "https://getbb.app",
  "X-Title": "BB",
};

const rawModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  context_length: z.number().nullish(),
  pricing: z
    .object({ prompt: z.string().nullish(), completion: z.string().nullish() })
    .nullish(),
  architecture: z
    .object({ output_modalities: z.array(z.string()).nullish() })
    .nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  reasoning: z
    .object({
      mandatory: z.boolean().nullish(),
      supported_efforts: z.array(z.string()).nullish(),
    })
    .nullish(),
});
type RawModel = z.infer<typeof rawModelSchema>;

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  /** USD per million tokens, or null when OpenRouter does not publish a fixed price. */
  promptPrice: number | null;
  completionPrice: number | null;
  reasoning: ReasoningParam;
}

/** The audio as BB hands it to `transcribe`, base64-encoded for OpenRouter. */
export interface AudioUpload {
  base64: string;
  filename: string;
  mimeType: string;
}

/** The catalog's `output_modalities` filter for each kind; it lists only text models by default. */
const OUTPUT_MODALITIES: Record<ServiceKind, string> = {
  inference: "text",
  voice: "transcription",
};

/** Fetch OpenRouter's public catalog and keep the models that serve `kind`. */
export async function fetchOpenRouterModels(
  kind: ServiceKind,
  signal?: AbortSignal,
): Promise<OpenRouterModel[]> {
  const modality = OUTPUT_MODALITIES[kind];
  const response = await fetch(`${OPENROUTER_API_BASE}/models?output_modalities=${modality}`, {
    headers: REQUEST_HEADERS,
    signal,
  });
  if (!response.ok) {
    throw new Error(`OpenRouter model list failed with HTTP ${response.status}`);
  }
  const body = z
    .object({ data: z.array(z.unknown()) })
    .parse(await response.json());
  const models: OpenRouterModel[] = [];
  for (const entry of body.data) {
    const parsed = rawModelSchema.safeParse(entry);
    if (!parsed.success) continue;
    const outputs = parsed.data.architecture?.output_modalities;
    if (outputs && !outputs.includes(modality)) continue;
    models.push(toModel(parsed.data, kind));
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

function toModel(raw: RawModel, kind: ServiceKind): OpenRouterModel {
  const name = raw.name ?? raw.id;
  // Speech-to-text prices mix per-token, per-second, and per-minute units, and
  // most of those models report a context length of 0, so the list shows neither.
  if (kind === "voice") {
    return { id: raw.id, name, contextLength: null, promptPrice: null, completionPrice: null, reasoning: null };
  }
  return {
    id: raw.id,
    name,
    contextLength: raw.context_length ?? null,
    promptPrice: perMillion(raw.pricing?.prompt),
    completionPrice: perMillion(raw.pricing?.completion),
    reasoning: reasoningParamFor(raw),
  };
}

function perMillion(value: string | null | undefined): number | null {
  if (value == null) return null;
  const perToken = Number(value);
  // The auto router publishes -1: its price depends on the routed model.
  if (!Number.isFinite(perToken) || perToken < 0) return null;
  return perToken * 1_000_000;
}

/**
 * Titles and commit messages are latency-bound, so turn reasoning off where
 * the model allows it, and use its cheapest effort where it does not.
 */
export function reasoningParamFor(raw: RawModel): ReasoningParam {
  if (!raw.supported_parameters?.includes("reasoning")) return null;
  const efforts = raw.reasoning?.supported_efforts ?? [];
  if (efforts.includes("none")) return { effort: "none" };
  if (raw.reasoning?.mandatory) {
    const cheapest = ["minimal", "low"].find((effort) => efforts.includes(effort));
    return cheapest ? { effort: cheapest, exclude: true } : { exclude: true };
  }
  return { enabled: false };
}

/**
 * BB owns the prompt and cleans the reply, so the request is a plain chat turn:
 * the model returns text as-is.
 */
export function buildCompletionRequest(
  prompt: string,
  config: Pick<ServiceConfig, "model" | "reasoning">,
): Record<string, unknown> {
  return {
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    ...(config.reasoning === null ? {} : { reasoning: config.reasoning }),
    stream: false,
  };
}

/** OpenRouter's `input_audio.format` names, keyed by file extension or MIME subtype. */
const AUDIO_FORMATS = new Map([
  ["aac", "aac"],
  ["flac", "flac"],
  ["m4a", "m4a"],
  ["mp3", "mp3"],
  ["mp4", "m4a"],
  ["mpeg", "mp3"],
  ["mpga", "mp3"],
  ["oga", "ogg"],
  ["ogg", "ogg"],
  ["opus", "ogg"],
  ["wav", "wav"],
  ["wave", "wav"],
  ["weba", "webm"],
  ["webm", "webm"],
]);

/**
 * The file extension wins over the MIME type: `bb voice transcribe` labels
 * every file audio/webm unless given --type, while browser recordings
 * (recording.webm, .mp4, .ogg) agree on both. Anything unrecognized is sent
 * as webm, BB's usual recording format.
 */
export function audioFormatFor(filename: string, mimeType: string): string {
  const extension = /\.([a-z\d]+)$/iu.exec(filename)?.[1]?.toLowerCase() ?? "";
  const subtype = /^(?:audio|video)\/(?:x-)?([a-z\d]+)/iu.exec(mimeType)?.[1]?.toLowerCase() ?? "";
  return AUDIO_FORMATS.get(extension) ?? AUDIO_FORMATS.get(subtype) ?? "webm";
}

/** Whisper reads only the last 224 tokens of a prompt, and longer ones bill more input tokens. */
const MAX_TRANSCRIPTION_PROMPT_CHARS = 1_000;

/** BB's transcription hint is vocabulary the speaker may use; keep its end, from a word boundary. */
export function transcriptionPromptTail(prompt: string | null): string | null {
  const trimmed = prompt?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length <= MAX_TRANSCRIPTION_PROMPT_CHARS) return trimmed;
  const tail = trimmed.slice(-MAX_TRANSCRIPTION_PROMPT_CHARS);
  const boundary = tail.search(/\s/u);
  return boundary === -1 ? tail : tail.slice(boundary).trim();
}

/**
 * OpenRouter's JSON transcription body has no prompt field, so the hint
 * goes under `provider.options` for the providers whose transcription APIs
 * take one. OpenRouter forwards only the serving provider's options.
 */
export function buildTranscriptionRequest(
  audio: AudioUpload,
  prompt: string | null,
  config: Pick<ServiceConfig, "transcriptionModel">,
): Record<string, unknown> {
  const tail = transcriptionPromptTail(prompt);
  return {
    model: config.transcriptionModel,
    input_audio: { data: audio.base64, format: audioFormatFor(audio.filename, audio.mimeType) },
    ...(tail === null ? {} : { provider: { options: { openai: { prompt: tail }, groq: { prompt: tail } } } }),
  };
}

/** OpenRouter error bodies carry the upstream HTTP status in `code`. */
const errorBodySchema = z.object({
  error: z.object({ code: z.unknown().optional(), message: z.string().optional() }),
});

/** POST JSON to OpenRouter. Transport failures and error replies throw. */
async function postToOpenRouter(
  path: string,
  request: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${OPENROUTER_API_BASE}${path}`, {
      method: "POST",
      headers: {
        ...REQUEST_HEADERS,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.any([signal, timeout]),
    });
    text = await response.text();
  } catch (error) {
    if (timeout.aborted) {
      throw new Error(`OpenRouter did not answer within ${timeoutMs}ms`);
    }
    throw new Error(`OpenRouter request failed: ${messageOf(error)}`);
  }

  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const errorBody = errorBodySchema.safeParse(body);
  if (!response.ok) {
    const detail = errorBody.data?.error.message ?? text.slice(0, 300);
    throw new Error(`OpenRouter HTTP ${response.status}: ${detail || response.statusText}`);
  }
  // Failures after OpenRouter has sent its 200 headers, such as provider rate
  // limits, arrive as a 200 with an error body.
  if (errorBody.success) {
    const { message } = errorBody.data.error;
    throw new Error(`OpenRouter error: ${message ?? "unknown"}`);
  }
  return body;
}

const completionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }).nullish(),
      }),
    )
    .optional(),
});

/** One helper completion. Returns the model's text, which BB cleans. */
export async function completeWithOpenRouter(
  prompt: string,
  config: ServiceConfig,
  signal: AbortSignal,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<string> {
  const body = await postToOpenRouter(
    "/chat/completions",
    buildCompletionRequest(prompt, config),
    config.apiKey,
    timeoutMs,
    signal,
  );
  const content = completionResponseSchema.safeParse(body).data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${config.model} returned no completion text`);
  }
  return content.trim();
}

const transcriptionResponseSchema = z.object({ text: z.string() });

/** One voice transcription. Returns the trimmed transcript. */
export async function transcribeWithOpenRouter(
  audio: AudioUpload,
  config: ServiceConfig,
  signal: AbortSignal,
  prompt: string | null = null,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<string> {
  const body = await postToOpenRouter(
    "/audio/transcriptions",
    buildTranscriptionRequest(audio, prompt, config),
    config.apiKey,
    timeoutMs,
    signal,
  );
  const parsed = transcriptionResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`${config.transcriptionModel} did not return a transcript`);
  }
  // Whisper-family models start their transcripts with a space.
  return parsed.data.text.trim();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
