import type {
  EnvironmentDisplayProviderLookup,
} from "../../vendor/core-ui/environment-display.js";
import {
  resolveEnvironmentDisplayProvider,
} from "../../vendor/core-ui/environment-display.js";
import type { PluginEnvironmentProvider } from "@get-bb/plugin-sdk/app";
import type { IconName } from "../../vendor/shared-ui/components/ui/icon.js";

export type EnvironmentWorkspaceDisplayProviderLookup =
  | { status: "loading" }
  | {
      status: "loaded";
      provider: PluginEnvironmentProvider | null;
      environmentProviderId: string | null;
    };

export const UNNAMED_ENVIRONMENT_LABEL = "Environment";

const PERSISTENT_HOST_ICON_NAME: IconName = "Laptop";

export function findEnvironmentDisplayProvider(
  providers: readonly PluginEnvironmentProvider[] | undefined,
  environmentProviderId: string | null,
): EnvironmentWorkspaceDisplayProviderLookup {
  if (environmentProviderId === null) {
    return { status: "loaded", provider: null, environmentProviderId: null };
  }
  if (providers === undefined) {
    return { status: "loading" };
  }
  return {
    status: "loaded",
    environmentProviderId,
    provider:
      providers.find((candidate) => candidate.id === environmentProviderId) ??
      null,
  };
}

export function getEnvironmentLabelIconName(
  providerLookup: EnvironmentDisplayProviderLookup,
): IconName {
  const provider = resolveEnvironmentDisplayProvider(providerLookup);
  return provider === null
    ? PERSISTENT_HOST_ICON_NAME
    : (provider.icon ?? "Zap");
}
