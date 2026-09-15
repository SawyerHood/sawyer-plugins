import { afterEach, describe, expect, it, vi } from "vitest";
import {
  audioFormatFor,
  buildCompletionRequest,
  buildTranscriptionRequest,
  completeWithOpenRouter,
  errorCodeForStatus,
  fetchOpenRouterModels,
  parseJsonObject,
  reasoningParamFor,
  transcribeWithOpenRouter,
  transcriptionPromptTail,
} from "./openrouter.js";

const input = {
  serviceId: "openrouter-inference",
  model: "default",
  reasoningEffort: "none" as const,
  prompt: "Title this thread",
  outputSchema: { type: "object", properties: { title: { type: "string", minLength: 1 } } },
  timeoutMs: 5_000,
};
const voiceInput = {
  serviceId: "openrouter-inference",
  model: "default",
  audioBase64: "T2dnUw==",
  filename: "recording.webm",
  mimeType: "audio/webm;codecs=opus",
  prompt: null,
  timeoutMs: 5_000,
};
const config = {
  apiKey: "sk-or-test",
  model: "google/gemini-2.5-flash-lite",
  reasoning: null,
  transcriptionModel: "openai/gpt-4o-mini-transcribe",
};
const LONG_PROMPT = `${"lorem ipsum ".repeat(200)}the OpenRouter plugin`;

function stubResponse(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubHangingFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchOpenRouterModels", () => {
  it("asks for transcription models and leaves out their mixed-unit prices", async () => {
    const fetchMock = stubResponse(200, {
      data: [
        {
          id: "openai/whisper-1",
          name: "OpenAI: Whisper 1",
          context_length: 0,
          pricing: { prompt: "0.006", completion: "0" },
          architecture: { output_modalities: ["transcription"] },
        },
        { id: "openai/gpt-4o", name: "OpenAI: GPT-4o", architecture: { output_modalities: ["text"] } },
      ],
    });
    expect(await fetchOpenRouterModels("voice")).toEqual([
      {
        id: "openai/whisper-1",
        name: "OpenAI: Whisper 1",
        contextLength: null,
        promptPrice: null,
        completionPrice: null,
        reasoning: null,
      },
    ]);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://openrouter.ai/api/v1/models?output_modalities=transcription");
  });

  it("keeps text models with per-million prices for inference", async () => {
    stubResponse(200, {
      data: [
        {
          id: "google/gemini-2.5-flash-lite",
          name: "Google: Gemini 2.5 Flash Lite",
          context_length: 1_048_576,
          pricing: { prompt: "0.0000001", completion: "0.0000004" },
          architecture: { output_modalities: ["text"] },
        },
        { id: "openai/whisper-1", architecture: { output_modalities: ["transcription"] } },
      ],
    });
    const models = await fetchOpenRouterModels("inference");
    expect(models.map((model) => model.id)).toEqual(["google/gemini-2.5-flash-lite"]);
    expect(models[0]?.promptPrice).toBeCloseTo(0.1);
  });
});

describe("reasoningParamFor", () => {
  it("omits reasoning for models without the parameter", () => {
    expect(reasoningParamFor({ id: "a", supported_parameters: ["tools"] })).toBeNull();
  });

  it("disables reasoning when the model supports effort none", () => {
    expect(
      reasoningParamFor({
        id: "a",
        supported_parameters: ["reasoning"],
        reasoning: { mandatory: false, supported_efforts: ["high", "low", "none"] },
      }),
    ).toEqual({ effort: "none" });
  });

  it("uses the cheapest effort for mandatory reasoning models", () => {
    expect(
      reasoningParamFor({
        id: "a",
        supported_parameters: ["reasoning"],
        reasoning: { mandatory: true, supported_efforts: ["high", "medium", "low"] },
      }),
    ).toEqual({ effort: "low", exclude: true });
    expect(
      reasoningParamFor({ id: "a", supported_parameters: ["reasoning"], reasoning: { mandatory: true } }),
    ).toEqual({ exclude: true });
  });

  it("turns optional reasoning off", () => {
    expect(
      reasoningParamFor({ id: "a", supported_parameters: ["reasoning"], reasoning: { mandatory: false } }),
    ).toEqual({ enabled: false });
  });
});

describe("buildCompletionRequest", () => {
  it("sends a strict schema and the configured model", () => {
    const request = buildCompletionRequest(input, { ...config, reasoning: { effort: "none" } });
    expect(request).toMatchObject({
      model: "google/gemini-2.5-flash-lite",
      reasoning: { effort: "none" },
      response_format: {
        type: "json_schema",
        json_schema: {
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["title"],
          },
        },
      },
    });
    expect(buildCompletionRequest(input, config)).not.toHaveProperty("reasoning");
  });
});

describe("parseJsonObject", () => {
  it("accepts bare, fenced, and prose-wrapped objects", () => {
    expect(parseJsonObject('{"title":"A"}')).toEqual({ title: "A" });
    expect(parseJsonObject('```json\n{"title":"B"}\n```')).toEqual({ title: "B" });
    expect(parseJsonObject('Here you go: {"title":"C"} hope that helps')).toEqual({ title: "C" });
  });

  it("rejects non-objects", () => {
    expect(parseJsonObject("[1,2]")).toBeNull();
    expect(parseJsonObject("no json")).toBeNull();
  });
});

describe("errorCodeForStatus", () => {
  it("maps HTTP statuses to BB's retry codes", () => {
    expect(errorCodeForStatus(401)).toBe("auth_required");
    expect(errorCodeForStatus(402)).toBe("rate_limited");
    expect(errorCodeForStatus(429)).toBe("rate_limited");
    expect(errorCodeForStatus(503)).toBe("service_unavailable");
    expect(errorCodeForStatus(400)).toBe("request_failed");
  });
});

describe("completeWithOpenRouter", () => {
  it("returns the parsed object and authenticates with the key", async () => {
    const fetchMock = stubResponse(200, {
      model: "google/gemini-2.5-flash-lite",
      choices: [{ message: { content: '{"title":"OpenRouter titles"}' } }],
    });
    const result = await completeWithOpenRouter(input, config, new AbortController().signal);
    expect(result).toEqual({
      ok: true,
      model: "google/gemini-2.5-flash-lite",
      value: { title: "OpenRouter titles" },
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer sk-or-test");
  });

  it("reports a bad key as auth_required with OpenRouter's message", async () => {
    stubResponse(401, { error: { message: "No auth credentials found" } });
    const result = await completeWithOpenRouter(input, config, new AbortController().signal);
    expect(result).toEqual({
      ok: false,
      code: "auth_required",
      message: "OpenRouter HTTP 401: No auth credentials found",
    });
  });

  it("maps an error delivered in a 200 reply by the status it carries", async () => {
    stubResponse(200, { error: { code: 429, message: "Rate limit exceeded" } });
    const result = await completeWithOpenRouter(input, config, new AbortController().signal);
    expect(result).toEqual({ ok: false, code: "rate_limited", message: "OpenRouter error: Rate limit exceeded" });
  });

  it("reports unparseable content as invalid_response", async () => {
    stubResponse(200, { choices: [{ message: { content: "Sure! A title." } }] });
    const result = await completeWithOpenRouter(input, config, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: "invalid_response" });
  });

  it("maps a request that outlives timeoutMs to timeout", async () => {
    stubHangingFetch();
    const result = await completeWithOpenRouter({ ...input, timeoutMs: 20 }, config, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });
});

describe("audioFormatFor", () => {
  it("names browser recordings by their extension", () => {
    expect(audioFormatFor("recording.webm", "audio/webm;codecs=opus")).toBe("webm");
    expect(audioFormatFor("recording.mp4", "audio/mp4")).toBe("m4a");
    expect(audioFormatFor("recording.ogg", "audio/ogg;codecs=opus")).toBe("ogg");
  });

  it("prefers the extension over bb voice transcribe's default MIME type", () => {
    expect(audioFormatFor("memo.WAV", "audio/webm")).toBe("wav");
  });

  it("falls back to the MIME subtype, then webm", () => {
    expect(audioFormatFor("voice-input", "audio/x-wav")).toBe("wav");
    expect(audioFormatFor("voice-input", "audio/mpeg")).toBe("mp3");
    expect(audioFormatFor("voice-input", "application/octet-stream")).toBe("webm");
    expect(audioFormatFor("clip.constructor", "")).toBe("webm");
  });
});

describe("transcriptionPromptTail", () => {
  it("drops blank prompts and keeps short ones whole", () => {
    expect(transcriptionPromptTail(null)).toBeNull();
    expect(transcriptionPromptTail("   ")).toBeNull();
    expect(transcriptionPromptTail(" Fix the BB sidebar ")).toBe("Fix the BB sidebar");
  });

  it("keeps the last 1,000 characters of a long prompt, starting at a word", () => {
    const tail = transcriptionPromptTail(LONG_PROMPT);
    expect(tail).toMatch(/^(?:lorem|ipsum) .* the OpenRouter plugin$/u);
    expect(tail?.length).toBeLessThanOrEqual(1_000);
    expect(tail?.length).toBeGreaterThan(950);
  });
});

describe("buildTranscriptionRequest", () => {
  it("sends the configured model and the audio format", () => {
    expect(buildTranscriptionRequest(voiceInput, config)).toEqual({
      model: "openai/gpt-4o-mini-transcribe",
      input_audio: { data: "T2dnUw==", format: "webm" },
    });
  });

  it("passes the prompt context to providers that accept one", () => {
    expect(buildTranscriptionRequest({ ...voiceInput, prompt: "Rename BB_TRANSCRIPTION" }, config)).toMatchObject({
      provider: {
        options: {
          openai: { prompt: "Rename BB_TRANSCRIPTION" },
          groq: { prompt: "Rename BB_TRANSCRIPTION" },
        },
      },
    });
  });

  it("sends only the end of a long prompt", () => {
    const tail = transcriptionPromptTail(LONG_PROMPT);
    expect(tail?.length).toBeLessThan(LONG_PROMPT.length);
    expect(buildTranscriptionRequest({ ...voiceInput, prompt: LONG_PROMPT }, config)).toMatchObject({
      provider: { options: { openai: { prompt: tail }, groq: { prompt: tail } } },
    });
  });
});

describe("transcribeWithOpenRouter", () => {
  it("posts the audio with the key and trims the transcript", async () => {
    const fetchMock = stubResponse(200, { text: " Testing voice transcription in BB.", usage: { seconds: 2.6 } });
    const result = await transcribeWithOpenRouter(voiceInput, config, new AbortController().signal);
    expect(result).toEqual({
      ok: true,
      model: "openai/gpt-4o-mini-transcribe",
      text: "Testing voice transcription in BB.",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer sk-or-test");
  });

  it("reports an unknown model as request_failed with OpenRouter's message", async () => {
    stubResponse(400, { error: { message: "Model openai/not-a-model does not exist", code: 400 } });
    const result = await transcribeWithOpenRouter(voiceInput, config, new AbortController().signal);
    expect(result).toEqual({
      ok: false,
      code: "request_failed",
      message: "OpenRouter HTTP 400: Model openai/not-a-model does not exist",
    });
  });

  it("reports a reply without text as invalid_response", async () => {
    stubResponse(200, { usage: { seconds: 1 } });
    const result = await transcribeWithOpenRouter(voiceInput, config, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: "invalid_response" });
  });

  it("maps a request that outlives timeoutMs to timeout", async () => {
    stubHangingFetch();
    const result = await transcribeWithOpenRouter({ ...voiceInput, timeoutMs: 20 }, config, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });
});
