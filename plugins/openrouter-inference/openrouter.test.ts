import { afterEach, describe, expect, it, vi } from "vitest";
import {
  audioFormatFor,
  buildCompletionRequest,
  buildTranscriptionRequest,
  completeWithOpenRouter,
  fetchOpenRouterModels,
  reasoningParamFor,
  transcribeWithOpenRouter,
  transcriptionPromptTail,
  type AudioUpload,
} from "./openrouter.js";

const audio: AudioUpload = { base64: "T2dnUw==", filename: "recording.webm", mimeType: "audio/webm;codecs=opus" };
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
  it("sends the prompt as a plain turn with the configured model", () => {
    expect(buildCompletionRequest("Title this thread", config)).toEqual({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "user", content: "Title this thread" }],
      stream: false,
    });
  });

  it("adds the model's reasoning override when there is one", () => {
    expect(buildCompletionRequest("Title this thread", { ...config, reasoning: { effort: "none" } })).toMatchObject({
      reasoning: { effort: "none" },
    });
  });
});

describe("completeWithOpenRouter", () => {
  it("returns the model's text and authenticates with the key", async () => {
    const fetchMock = stubResponse(200, {
      model: "google/gemini-2.5-flash-lite",
      choices: [{ message: { content: "  OpenRouter titles  " } }],
    });
    expect(await completeWithOpenRouter("Title this thread", config, new AbortController().signal)).toBe(
      "OpenRouter titles",
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer sk-or-test");
  });

  it("reports a bad key with OpenRouter's message", async () => {
    stubResponse(401, { error: { message: "No auth credentials found" } });
    await expect(completeWithOpenRouter("Title", config, new AbortController().signal)).rejects.toThrow(
      "OpenRouter HTTP 401: No auth credentials found",
    );
  });

  it("reports an error delivered in a 200 reply", async () => {
    stubResponse(200, { error: { code: 429, message: "Rate limit exceeded" } });
    await expect(completeWithOpenRouter("Title", config, new AbortController().signal)).rejects.toThrow(
      "OpenRouter error: Rate limit exceeded",
    );
  });

  it("reports a reply with no completion text", async () => {
    stubResponse(200, { choices: [{ message: { content: null } }] });
    await expect(completeWithOpenRouter("Title", config, new AbortController().signal)).rejects.toThrow(
      "google/gemini-2.5-flash-lite returned no completion text",
    );
  });

  it("maps a request that outlives its timeout to a timeout error", async () => {
    stubHangingFetch();
    await expect(
      completeWithOpenRouter("Title", config, new AbortController().signal, 20),
    ).rejects.toThrow("OpenRouter did not answer within 20ms");
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
    expect(buildTranscriptionRequest(audio, null, config)).toEqual({
      model: "openai/gpt-4o-mini-transcribe",
      input_audio: { data: "T2dnUw==", format: "webm" },
    });
  });

  it("passes the hint to providers that accept one", () => {
    expect(buildTranscriptionRequest(audio, "Rename BB_TRANSCRIPTION", config)).toMatchObject({
      provider: {
        options: {
          openai: { prompt: "Rename BB_TRANSCRIPTION" },
          groq: { prompt: "Rename BB_TRANSCRIPTION" },
        },
      },
    });
  });

  it("sends only the end of a long hint", () => {
    const tail = transcriptionPromptTail(LONG_PROMPT);
    expect(tail?.length).toBeLessThan(LONG_PROMPT.length);
    expect(buildTranscriptionRequest(audio, LONG_PROMPT, config)).toMatchObject({
      provider: { options: { openai: { prompt: tail }, groq: { prompt: tail } } },
    });
  });
});

describe("transcribeWithOpenRouter", () => {
  it("posts the audio with the key and trims the transcript", async () => {
    const fetchMock = stubResponse(200, { text: " Testing voice transcription in BB.", usage: { seconds: 2.6 } });
    expect(await transcribeWithOpenRouter(audio, config, new AbortController().signal)).toBe(
      "Testing voice transcription in BB.",
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer sk-or-test");
  });

  it("forwards the hint as provider options", async () => {
    const fetchMock = stubResponse(200, { text: "hi" });
    await transcribeWithOpenRouter(audio, config, new AbortController().signal, "BB_TRANSCRIPTION");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      provider: { options: { openai: { prompt: "BB_TRANSCRIPTION" } } },
    });
  });

  it("reports an unknown model with OpenRouter's message", async () => {
    stubResponse(400, { error: { message: "Model openai/not-a-model does not exist", code: 400 } });
    await expect(transcribeWithOpenRouter(audio, config, new AbortController().signal)).rejects.toThrow(
      "OpenRouter HTTP 400: Model openai/not-a-model does not exist",
    );
  });

  it("reports a reply without text", async () => {
    stubResponse(200, { usage: { seconds: 1 } });
    await expect(transcribeWithOpenRouter(audio, config, new AbortController().signal)).rejects.toThrow(
      "openai/gpt-4o-mini-transcribe did not return a transcript",
    );
  });

  it("maps a request that outlives its timeout to a timeout error", async () => {
    stubHangingFetch();
    await expect(
      transcribeWithOpenRouter(audio, config, new AbortController().signal, null, 20),
    ).rejects.toThrow("OpenRouter did not answer within 20ms");
  });
});
