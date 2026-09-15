// OpenRouter HTTP helpers shared by the server (model catalogs) and the host
// (completions and transcriptions). Everything here is plain fetch plus pure
// functions.
import type {
  ExperimentalAiInferenceCompleteInput,
  ExperimentalAiInferenceCompleteOutput,
  ExperimentalAiServiceErrorCode,
  ExperimentalAiVoiceTranscribeInput,
  ExperimentalAiVoiceTranscribeOutput,
} from "@get-bb/plugin-sdk/ai-services";
import { z } from "zod";
import type { HostConfig, ReasoningParam, ServiceKind } from "./contract.js";

export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

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
type JsonObject = Extract<
  ExperimentalAiInferenceCompleteOutput,
  { ok: true }
>["value"];
type AiServiceFailure = { ok: false; code: ExperimentalAiServiceErrorCode; message: string };

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  /** USD per million tokens, or null when OpenRouter does not publish a fixed price. */
  promptPrice: number | null;
  completionPrice: number | null;
  reasoning: ReasoningParam;
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

/** OpenAI-style strict schemas need closed objects with every property required. */
export function withStrictObjectSchemas(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withStrictObjectSchemas);
  if (value === null || typeof value !== "object") return value;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] = withStrictObjectSchemas(child);
  }
  if (normalized.type === "object") {
    normalized.additionalProperties ??= false;
    const properties = normalized.properties;
    normalized.required =
      properties !== null && typeof properties === "object"
        ? Object.keys(properties)
        : [];
  }
  return normalized;
}

export function buildCompletionRequest(
  input: Pick<ExperimentalAiInferenceCompleteInput, "prompt" | "outputSchema">,
  config: Pick<HostConfig, "model" | "reasoning">,
): Record<string, unknown> {
  const schema = withStrictObjectSchemas(input.outputSchema);
  return {
    model: config.model,
    messages: [
      {
        role: "system",
        content:
          "Follow the user prompt. Respond with only a JSON object that matches this JSON Schema, with no prose or code fences:\n" +
          JSON.stringify(schema),
      },
      { role: "user", content: input.prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "result", strict: true, schema },
    },
    ...(config.reasoning === null ? {} : { reasoning: config.reasoning }),
    stream: false,
  };
}

/** Parse the model's reply, tolerating code fences or stray prose around the object. */
export function parseJsonObject(content: string): JsonObject | null {
  const candidates = [content.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(content);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(content.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return value as JsonObject;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
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

/** BB's transcription context is the composer text before the cursor; keep its end, from a word boundary. */
export function transcriptionPromptTail(prompt: string | null): string | null {
  const trimmed = prompt?.trim() ?? "";
  if (trimmed === "") return null;
  if (trimmed.length <= MAX_TRANSCRIPTION_PROMPT_CHARS) return trimmed;
  const tail = trimmed.slice(-MAX_TRANSCRIPTION_PROMPT_CHARS);
  const boundary = tail.search(/\s/u);
  return (boundary === -1 ? tail : tail.slice(boundary)).trim();
}

/**
 * OpenRouter's JSON transcription body has no prompt field, so the context
 * goes under `provider.options` for the providers whose transcription APIs
 * take one. OpenRouter forwards only the serving provider's options.
 */
export function buildTranscriptionRequest(
  input: Pick<ExperimentalAiVoiceTranscribeInput, "audioBase64" | "filename" | "mimeType" | "prompt">,
  config: Pick<HostConfig, "transcriptionModel">,
): Record<string, unknown> {
  const prompt = transcriptionPromptTail(input.prompt);
  return {
    model: config.transcriptionModel,
    input_audio: { data: input.audioBase64, format: audioFormatFor(input.filename, input.mimeType) },
    ...(prompt === null ? {} : { provider: { options: { openai: { prompt }, groq: { prompt } } } }),
  };
}

export function errorCodeForStatus(status: number): ExperimentalAiServiceErrorCode {
  if (status === 401 || status === 403) return "auth_required";
  if (status === 402 || status === 429) return "rate_limited";
  if (status === 408) return "timeout";
  if (status >= 500) return "service_unavailable";
  return "request_failed";
}

/** OpenRouter error bodies carry the upstream HTTP status in `code`. */
const errorBodySchema = z.object({
  error: z.object({ code: z.unknown().optional(), message: z.string().optional() }),
});

/** POST JSON to OpenRouter, mapping transport failures and error replies to BB's AI-service codes. */
async function postToOpenRouter(
  path: string,
  request: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ ok: true; body: unknown } | AiServiceFailure> {
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
      return failure("timeout", `OpenRouter did not answer within ${timeoutMs}ms`);
    }
    return failure("service_unavailable", `OpenRouter request failed: ${messageOf(error)}`);
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
    return failure(
      errorCodeForStatus(response.status),
      `OpenRouter HTTP ${response.status}: ${detail || response.statusText}`,
    );
  }
  // Failures after OpenRouter has sent its 200 headers, such as provider rate
  // limits, arrive as a 200 with an error body.
  if (errorBody.success) {
    const { code, message } = errorBody.data.error;
    return failure(
      typeof code === "number" ? errorCodeForStatus(code) : "request_failed",
      `OpenRouter error: ${message ?? "unknown"}`,
    );
  }
  return { ok: true, body };
}

const completionResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }).nullish(),
      }),
    )
    .optional(),
});

export async function completeWithOpenRouter(
  input: ExperimentalAiInferenceCompleteInput,
  config: HostConfig,
  signal: AbortSignal,
): Promise<ExperimentalAiInferenceCompleteOutput> {
  const reply = await postToOpenRouter(
    "/chat/completions",
    buildCompletionRequest(input, config),
    config.apiKey,
    input.timeoutMs,
    signal,
  );
  if (!reply.ok) return reply;
  const body = completionResponseSchema.safeParse(reply.body).data;
  const content = body?.choices?.[0]?.message?.content;
  const value = content ? parseJsonObject(content) : null;
  if (value === null) {
    return failure(
      "invalid_response",
      `${config.model} did not return a JSON object${content ? `: ${content.slice(0, 200)}` : ""}`,
    );
  }
  return { ok: true, model: body?.model ?? config.model, value };
}

const transcriptionResponseSchema = z.object({ text: z.string() });

export async function transcribeWithOpenRouter(
  input: ExperimentalAiVoiceTranscribeInput,
  config: HostConfig,
  signal: AbortSignal,
): Promise<ExperimentalAiVoiceTranscribeOutput> {
  const reply = await postToOpenRouter(
    "/audio/transcriptions",
    buildTranscriptionRequest(input, config),
    config.apiKey,
    input.timeoutMs,
    signal,
  );
  if (!reply.ok) return reply;
  const body = transcriptionResponseSchema.safeParse(reply.body);
  if (!body.success) {
    return failure("invalid_response", `${config.transcriptionModel} did not return a transcript`);
  }
  // Whisper-family models start their transcripts with a space.
  return { ok: true, model: config.transcriptionModel, text: body.data.text.trim() };
}

export function failure(code: ExperimentalAiServiceErrorCode, message: string): AiServiceFailure {
  return { ok: false, code, message };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
