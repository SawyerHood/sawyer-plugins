import { describe, expect, it, vi } from "vitest";
import { decisionRoutes, type DecisionConnection } from "./decision-routes";
import { askChoicesVia, warmRoutes } from "./jev";

const config: DecisionConnection = {
  jevProvider: "selfhosted", systemOneUrl: "https://models.example/v1/systemone",
  systemOneModel: "kev-4b", systemOneApiKey: "local-token", systemOneCloudFallback: false,
  layaUrl: "http://127.0.0.1:8899/decisions", layaModel: "laya/english",
  gatewayApiKey: "gateway-token", openRouterApiKey: "router-token",
  jevModel: "gateway-model", openRouterJevModel: "router-model",
};
const request = { state: "Pick a project", questions: {
  project: { instructions: "Choose", options: { notes: "Notes", media: "Media" } },
} };
const answer = JSON.stringify({ answers: { q0: { type: "choice", choice: "notes" } } });

describe("local and gateway connections", () => {
  it("keeps self-hosted exclusive by default even when all cloud keys are set", () => {
    expect(decisionRoutes(config)).toEqual([{
      provider: "selfhosted", apiKey: "local-token", model: "kev-4b",
      baseUrl: "https://models.example/v1/systemone",
    }]);
  });

  it("selects OpenRouter without losing the independently configured self-hosted endpoint", () => {
    expect(decisionRoutes({ ...config, jevProvider: "openrouter" })).toEqual([
      { provider: "openrouter", apiKey: "router-token", model: "router-model" },
    ]);
    expect(decisionRoutes(config)[0]?.model).toBe("kev-4b");
  });

  it("preserves the base local/gateway auto order and omits unset keys", () => {
    expect(decisionRoutes({ ...config, jevProvider: "auto" }).map(r => r.provider)).toEqual(["local", "vercel", "openrouter"]);
    expect(decisionRoutes({ ...config, jevProvider: "auto", gatewayApiKey: " " }).map(r => r.provider)).toEqual(["local", "openrouter"]);
    expect(decisionRoutes({ ...config, jevProvider: "openrouter", openRouterApiKey: undefined })).toEqual([]);
  });

  it("adds cloud routes after self-hosted only with explicit opt-in", () => {
    expect(decisionRoutes({ ...config, systemOneCloudFallback: true }).map(r => r.provider)).toEqual(["selfhosted", "openrouter", "vercel"]);
    expect(decisionRoutes({ ...config, systemOneCloudFallback: true, openRouterApiKey: null, gatewayApiKey: "" }).map(r => r.provider)).toEqual(["selfhosted"]);
  });

  it("allows an unauthenticated self-hosted endpoint and fails closed on unknown providers", () => {
    expect(decisionRoutes({ ...config, systemOneApiKey: undefined })[0]?.apiKey).toBeNull();
    expect(() => decisionRoutes({ ...config, jevProvider: "typo" })).toThrow("supported decision provider");
  });

  it("never sends a failed self-hosted request to the cloud with fallback off", async () => {
    const calls: string[] = [];
    await expect(askChoicesVia(decisionRoutes(config), { ...request, fetchImpl: async url => {
      calls.push(String(url)); throw new Error("local offline");
    } })).rejects.toThrow("Self-hosted server");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(url => url === config.systemOneUrl)).toBe(true);
  });

  it("uses the cloud backup after self-hosted fails only when opted in", async () => {
    const calls: string[] = [];
    const result = await askChoicesVia(decisionRoutes({ ...config, systemOneCloudFallback: true }), {
      ...request, fetchImpl: async url => {
        calls.push(String(url));
        if (url === config.systemOneUrl) throw new Error("local offline");
        return new Response(answer);
      },
    });
    expect(result.project?.choice).toBe("notes");
    expect(calls.at(-1)).toBe("https://openrouter.ai/api/alpha/decisions");
  });

  it("does not touch cloud backups when self-hosted succeeds or the request is canceled", async () => {
    const fetchImpl = vi.fn(async () => new Response(answer));
    const routes = decisionRoutes({ ...config, systemOneCloudFallback: true });
    await askChoicesVia(routes, { ...request, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    fetchImpl.mockClear();
    await expect(askChoicesVia(routes, { ...request, fetchImpl, signal: controller.signal })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


describe("explicit local and remote modes", () => {
  it("uses only the #6 sidecar and its independent model in local mode", () => {
    expect(decisionRoutes({ ...config, jevProvider: "local", systemOneCloudFallback: true })).toEqual([
      { provider: "local", apiKey: null, model: "laya/english", baseUrl: config.layaUrl },
    ]);
  });

  it("completes an origin only for the sidecar, not the external URL", () => {
    expect(decisionRoutes({ ...config, jevProvider: "local", layaUrl: "http://127.0.0.1:9000" })[0]?.baseUrl)
      .toBe("http://127.0.0.1:9000/decisions");
    expect(decisionRoutes({ ...config, systemOneUrl: "https://models.example/custom/decide" })[0]?.baseUrl)
      .toBe("https://models.example/custom/decide");
  });

  it("does not read or probe the local endpoint when remote is selected", async () => {
    const routes = decisionRoutes({ ...config, layaUrl: "not a URL" });
    const calls: string[] = [];
    await askChoicesVia(routes, { ...request, fetchImpl: async url => {
      calls.push(String(url)); return new Response(answer);
    } });
    expect(calls).toEqual([config.systemOneUrl]);
  });

  it("never tries local when a remote request fails, even with cloud backups enabled", async () => {
    const routes = decisionRoutes({ ...config, systemOneCloudFallback: true });
    const calls: string[] = [];
    await expect(askChoicesVia(routes, { ...request, fetchImpl: async url => {
      calls.push(String(url)); throw new Error("offline");
    } })).rejects.toThrow();
    expect(calls).not.toContain(config.layaUrl);
    expect(routes.map(r => r.provider)).toEqual(["selfhosted", "openrouter", "vercel"]);
  });

  it("requires a remote URL and model instead of silently selecting local", () => {
    expect(() => decisionRoutes({ ...config, systemOneUrl: "" })).toThrow("complete URL and model ID");
    expect(() => decisionRoutes({ ...config, systemOneModel: " " })).toThrow("complete URL and model ID");
  });

  it("reads the prototype provider value as the remote connection only", () => {
    expect(decisionRoutes({ ...config, jevProvider: "systemone" })).toEqual(decisionRoutes(config));
  });
});


describe("warming the selected connection", () => {
  it.each(["local", "selfhosted"])("uses HTTP/1.1 and only the %s endpoint", async provider => {
    const routes = decisionRoutes({ ...config, jevProvider: provider });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      answers: { q0: { type: "choice", choice: "yes", probabilities: { yes: 1, no: 0 } } },
    })));
    try {
      await warmRoutes(routes);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(provider === "local" ? config.layaUrl : config.systemOneUrl);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
