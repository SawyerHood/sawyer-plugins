import { DEFAULT_LAYA_URL } from "./preferences";
import type { JevRoute } from "./jev";

export interface DecisionConnection {
  jevProvider: string;
  gatewayApiKey?: unknown;
  openRouterApiKey?: unknown;
  jevModel: string;
  openRouterJevModel: string;
  layaUrl: string;
  layaModel: string;
  systemOneUrl: string;
  systemOneModel: string;
  systemOneApiKey?: unknown;
  systemOneCloudFallback: boolean;
}

/** Keep #6's origin shorthand for its local sidecar only. Remote URLs are complete endpoints. */
function localEndpoint(value: string): string {
  const url = new URL(value.trim() || DEFAULT_LAYA_URL);
  if (url.pathname === "/") url.pathname = "/decisions";
  return url.toString();
}

/** Only the explicitly selected mode supplies the first route. No server processes are started. */
export function decisionRoutes(config: DecisionConnection): JevRoute[] {
  const secret = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  const keys = { vercel: secret(config.gatewayApiKey), openrouter: secret(config.openRouterApiKey) };
  const models = { vercel: config.jevModel, openrouter: config.openRouterJevModel };
  const cloud = (order: readonly ("vercel" | "openrouter")[]): JevRoute[] =>
    order.flatMap((provider) => {
      const apiKey = keys[provider];
      return apiKey === null ? [] : [{ provider, apiKey, model: models[provider] }];
    });
  const local = (): JevRoute => ({ provider: "local", apiKey: null,
    model: config.layaModel, baseUrl: localEndpoint(config.layaUrl) });

  switch (config.jevProvider) {
    case "selfhosted":
    case "systemone": // Read compatibility with the earlier self-hosted prototype.
      if (!config.systemOneUrl.trim() || !config.systemOneModel.trim()) {
        throw new Error("Set the self-hosted server's complete URL and model ID in Magic Compose settings.");
      }
      return [{ provider: "selfhosted", apiKey: secret(config.systemOneApiKey),
        model: config.systemOneModel.trim(), baseUrl: config.systemOneUrl.trim() },
        ...(config.systemOneCloudFallback ? cloud(["openrouter", "vercel"]) : [])];
    case "local": return [local()];
    case "openrouter": return cloud(["openrouter"]);
    case "vercel": return cloud(["vercel"]);
    // Preserve #6's auto order. The external server is never implicitly selected.
    case "auto": return [local(), ...cloud(["vercel", "openrouter"])];
    default: throw new Error("Select a supported decision provider in Magic Compose settings.");
  }
}
