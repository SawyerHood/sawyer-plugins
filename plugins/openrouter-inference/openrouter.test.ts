import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCompletionRequest,
  completeWithOpenRouter,
  errorCodeForStatus,
  parseJsonObject,
  reasoningParamFor,
} from "./openrouter.js";

const input = {
  serviceId: "openrouter-inference",
  model: "default",
  reasoningEffort: "none" as const,
  prompt: "Title this thread",
  outputSchema: { type: "object", properties: { title: { type: "string", minLength: 1 } } },
  timeoutMs: 5_000,
};
const config = { apiKey: "sk-or-test", model: "google/gemini-2.5-flash-lite", reasoning: null };

afterEach(() => {
  vi.unstubAllGlobals();
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
  function stubResponse(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

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

  it("reports unparseable content as invalid_response", async () => {
    stubResponse(200, { choices: [{ message: { content: "Sure! A title." } }] });
    const result = await completeWithOpenRouter(input, config, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: "invalid_response" });
  });

  it("maps a request that outlives timeoutMs to timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );
    const result = await completeWithOpenRouter({ ...input, timeoutMs: 20 }, config, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });
});
