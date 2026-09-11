// OpenRouter HTTP helpers shared by the server (model catalog) and the host
// (completions). Everything here is plain fetch plus pure functions.
import type {
  ExperimentalAiInferenceCompleteInput,
  ExperimentalAiInferenceCompleteOutput,
  ExperimentalAiServiceErrorCode,
} from "@get-bb/plugin-sdk/ai-services";
import { z } from "zod";
import type { HostConfig, ReasoningParam } from "./contract.js";

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

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  /** USD per million tokens, or null when OpenRouter does not publish a fixed price. */
  promptPrice: number | null;
  completionPrice: number | null;
  reasoning: ReasoningParam;
}

/** Fetch OpenRouter's public catalog and keep the models that answer in text. */
export async function fetchOpenRouterModels(
  signal?: AbortSignal,
): Promise<OpenRouterModel[]> {
  const response = await fetch(`${OPENROUTER_API_BASE}/models`, {
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
    if (outputs && !outputs.includes("text")) continue;
    models.push(toModel(parsed.data));
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

function toModel(raw: RawModel): OpenRouterModel {
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
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

export function errorCodeForStatus(status: number): ExperimentalAiServiceErrorCode {
  if (status === 401 || status === 403) return "auth_required";
  if (status === 402 || status === 429) return "rate_limited";
  if (status === 408) return "timeout";
  if (status >= 500) return "service_unavailable";
  return "request_failed";
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
  error: z.object({ message: z.string().optional() }).optional(),
});

export async function completeWithOpenRouter(
  input: ExperimentalAiInferenceCompleteInput,
  config: HostConfig,
  signal: AbortSignal,
): Promise<ExperimentalAiInferenceCompleteOutput> {
  const timeout = AbortSignal.timeout(input.timeoutMs);
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        ...REQUEST_HEADERS,
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildCompletionRequest(input, config)),
      signal: AbortSignal.any([signal, timeout]),
    });
    text = await response.text();
  } catch (error) {
    if (timeout.aborted) {
      return failure("timeout", `OpenRouter did not answer within ${input.timeoutMs}ms`);
    }
    return failure("service_unavailable", `OpenRouter request failed: ${messageOf(error)}`);
  }

  let body: z.infer<typeof completionResponseSchema> | null = null;
  try {
    body = completionResponseSchema.parse(JSON.parse(text));
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = body?.error?.message ?? text.slice(0, 300);
    return failure(
      errorCodeForStatus(response.status),
      `OpenRouter HTTP ${response.status}: ${detail || response.statusText}`,
    );
  }
  if (body?.error) {
    return failure("request_failed", `OpenRouter error: ${body.error.message ?? "unknown"}`);
  }
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

export function failure(
  code: ExperimentalAiServiceErrorCode,
  message: string,
): { ok: false; code: ExperimentalAiServiceErrorCode; message: string } {
  return { ok: false, code, message };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
