import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin, { type Status } from "./server.js";

const pluginId = "openrouter-inference";
const service = {
  id: "openrouter-inference",
  pluginId,
  displayName: "OpenRouter (API key)",
  automaticRank: null,
  status: { ready: true },
  tasks: ["thread-title", "commit-message", "voice"],
};
const automatic = {
  selections: {
    "thread-title": { mode: "automatic" },
    "commit-message": { mode: "automatic" },
    voice: { mode: "automatic" },
  },
  services: [service],
};

async function load(options: { apiKey?: string; state?: unknown } = {}) {
  const state = (options.state ?? automatic) as typeof automatic;
  const host = createFakePluginHost({
    pluginId,
    settings: options.apiKey === undefined ? {} : { apiKey: options.apiKey },
    sdk: {
      system: {
        aiServices: async () => state,
        setAiServiceSelection: async () => state,
      },
    },
  });
  await plugin(host.bb);
  const registration = host.harness.registrations.aiServiceRegistrations[0];
  if (!registration) throw new Error("the plugin registered no AI service");
  return { host, registration };
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The body of the last request: building the config first fetches the model catalog. */
function sentBody(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
  return JSON.parse(String(init.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the registered AI service", () => {
  it("declares both functions BB 0.44 requires", async () => {
    const { registration } = await load({ apiKey: "sk-or-test" });
    expect(registration.id).toBe("openrouter-inference");
    expect(typeof registration.complete).toBe("function");
    expect(typeof registration.transcribe).toBe("function");
  });

  it("is not ready without an API key", async () => {
    const { registration } = await load();
    expect(await registration.status?.()).toEqual({
      ready: false,
      message: "Add an OpenRouter API key in the OpenRouter Inference plugin settings.",
    });
  });

  it("completes with the configured model and returns the text", async () => {
    const fetchMock = stubFetch(200, { choices: [{ message: { content: "OpenRouter titles" } }] });
    const { registration } = await load({ apiKey: "sk-or-test" });
    const complete = registration.complete as NonNullable<typeof registration.complete>;
    expect(await complete("Title this thread", { signal: new AbortController().signal })).toBe("OpenRouter titles");
    expect(sentBody(fetchMock)).toMatchObject({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "user", content: "Title this thread" }],
    });
  });

  it("refuses to complete without an API key", async () => {
    const { registration } = await load();
    const complete = registration.complete as NonNullable<typeof registration.complete>;
    await expect(complete("Title", { signal: new AbortController().signal })).rejects.toThrow(
      "Add an OpenRouter API key",
    );
  });

  it("transcribes the File BB hands it, base64-encoded, with its hint", async () => {
    const fetchMock = stubFetch(200, { text: " Hello from BB." });
    const { registration } = await load({ apiKey: "sk-or-test" });
    const transcribe = registration.transcribe as NonNullable<typeof registration.transcribe>;
    const audio = new File([new Uint8Array([0x4f, 0x67, 0x75, 0x53])], "recording.webm", {
      type: "audio/webm;codecs=opus",
    });
    expect(await transcribe(audio, { signal: new AbortController().signal, hint: "BB sidebar" })).toBe(
      "Hello from BB.",
    );
    expect(sentBody(fetchMock)).toMatchObject({
      model: "openai/gpt-4o-mini-transcribe",
      input_audio: { data: "T2d1Uw==", format: "webm" },
      provider: { options: { openai: { prompt: "BB sidebar" } } },
    });
  });
});

describe("status", () => {
  it("reports BB's automatic selection as not this plugin", async () => {
    const { host } = await load({ apiKey: "sk-or-test" });
    const status = (await host.harness.behavior.callRpc("status")) as Status;
    expect(status).toMatchObject({
      hasApiKey: true,
      model: "google/gemini-2.5-flash-lite",
      selection: { inference: { mode: "automatic", selected: false }, voice: { selected: false } },
    });
  });

  it("reports the plugin as selected once BB routes both title tasks to it", async () => {
    const { host } = await load({
      apiKey: "sk-or-test",
      state: {
        selections: {
          "thread-title": { mode: "service", pluginId, serviceId: "openrouter-inference" },
          "commit-message": { mode: "service", pluginId, serviceId: "openrouter-inference" },
          voice: { mode: "service", pluginId, serviceId: "provider-claude-code" },
        },
        services: [service],
      },
    });
    const status = (await host.harness.behavior.callRpc("status")) as Status;
    expect(status.selection.inference.selected).toBe(true);
    expect(status.selection.voice).toEqual({
      mode: "service",
      serviceId: "provider-claude-code",
      selected: false,
    });
  });

  it("surfaces why BB considers the service unusable", async () => {
    const { host } = await load({
      state: {
        selections: automatic.selections,
        services: [{ ...service, status: { ready: false, message: "Add an OpenRouter API key." } }],
      },
    });
    const status = (await host.harness.behavior.callRpc("status")) as Status;
    expect(status.serviceMessage).toBe("Add an OpenRouter API key.");
  });
});

describe("useFor", () => {
  it("routes the inference kind's two tasks, and the voice task, to this plugin", async () => {
    const { host } = await load({ apiKey: "sk-or-test" });
    await host.harness.behavior.callRpc("useFor", { kind: "inference" });
    await host.harness.behavior.callRpc("useFor", { kind: "voice" });
    const calls = host.harness.inspection.sdk.callsTo("system.setAiServiceSelection");
    expect(calls.map(([args]) => (args as { task: string }).task)).toEqual([
      "thread-title",
      "commit-message",
      "voice",
    ]);
    expect(calls[0]?.[0]).toMatchObject({
      selection: { mode: "service", pluginId, serviceId: "openrouter-inference" },
    });
  });
});
