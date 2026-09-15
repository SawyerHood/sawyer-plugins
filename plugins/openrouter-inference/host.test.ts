import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import hostEntry from "./host.js";

const config = {
  apiKey: "sk-or-test",
  model: "google/gemini-2.5-flash-lite",
  reasoning: null,
  transcriptionModel: "openai/whisper-large-v3-turbo",
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

let dataDir: string;
const harnesses: Array<{ experimental_dispose(): Promise<void> }> = [];

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "openrouter-host-"));
});

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.experimental_dispose()));
  vi.unstubAllGlobals();
  await rm(dataDir, { recursive: true, force: true });
});

function createHost() {
  const harness = experimental_createHostEntryHarness(hostEntry, {
    experimental_paths: { dataDir, tempDir: dataDir },
  });
  harnesses.push(harness);
  return harness;
}

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>): unknown {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body));
}

describe("ai.voice.transcribe", () => {
  it("transcribes with the configured model", async () => {
    const fetchMock = stubFetch({ text: " Hello from BB." });
    const host = createHost();
    await host.experimental_call("configure", { config });
    expect(await host.experimental_call("ai.voice.transcribe", voiceInput)).toEqual({
      ok: true,
      model: "openai/whisper-large-v3-turbo",
      text: "Hello from BB.",
    });
    expect(sentBody(fetchMock)).toMatchObject({
      model: "openai/whisper-large-v3-turbo",
      input_audio: { data: "T2dnUw==", format: "webm" },
    });
  });

  it("answers auth_required before an API key is configured", async () => {
    const host = createHost();
    expect(await host.experimental_call("ai.voice.transcribe", voiceInput)).toMatchObject({
      ok: false,
      code: "auth_required",
    });
  });

  it("refuses a service id this plugin does not serve", async () => {
    const host = createHost();
    await host.experimental_call("configure", { config });
    expect(await host.experimental_call("ai.voice.transcribe", { ...voiceInput, serviceId: "codex" })).toMatchObject({
      ok: false,
      code: "request_failed",
    });
  });
});

describe("test", () => {
  it("transcribes the built-in clip as ogg", async () => {
    const fetchMock = stubFetch({ text: "Testing voice transcription in BB." });
    const host = createHost();
    await host.experimental_call("configure", { config });
    expect(await host.experimental_call("test", { kind: "voice" })).toMatchObject({
      ok: true,
      text: "Testing voice transcription in BB.",
      model: "openai/whisper-large-v3-turbo",
    });
    expect(sentBody(fetchMock)).toMatchObject({ input_audio: { format: "ogg" } });
  });
});

describe("a config file written by 0.1.0", () => {
  it("still serves inference without a transcription model", async () => {
    await writeFile(
      join(dataDir, "openrouter.json"),
      JSON.stringify({ apiKey: "sk-or-test", model: "google/gemini-2.5-flash-lite", reasoning: null }),
    );
    const fetchMock = stubFetch({ choices: [{ message: { content: '{"title":"Upgraded"}' } }] });
    const host = createHost();
    const result = await host.experimental_call("ai.inference.complete", {
      serviceId: "openrouter-inference",
      model: "default",
      reasoningEffort: "none",
      prompt: "Title this thread",
      outputSchema: { type: "object", properties: { title: { type: "string" } } },
      timeoutMs: 5_000,
    });
    expect(result).toEqual({ ok: true, model: "google/gemini-2.5-flash-lite", value: { title: "Upgraded" } });
    expect(sentBody(fetchMock)).toMatchObject({ model: "google/gemini-2.5-flash-lite" });
  });
});
