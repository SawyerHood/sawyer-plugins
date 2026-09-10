import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import { registerCli } from "./cli.js";
import { cowHostContract, cowHostSignals } from "./contract.js";
import { COW_COPY_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

const CREATE_TIMEOUT_MS = 15 * 60 * 1000;
const REMOVE_TIMEOUT_MS = 15 * 60 * 1000;
const PROBE_TIMEOUT_MS = 30 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function cowCopyPlugin(bb: BbPluginApi): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: cowHostContract,
    experimental_signals: cowHostSignals,
  });
  const reports = new Map<string, PluginEnvironmentProviderProgress>();

  host.experimental_onSignal("progress", (event) => {
    const report = reports.get(event.payload.operationId);
    if (report === undefined) return;
    if (event.payload.kind === "step") report.step(event.payload.text);
    else report.log(event.payload.text);
  });

  registerCli(bb, host);

  bb.experimental_environments.register({
    id: COW_COPY_ENVIRONMENT_PROVIDER_ID,
    displayName: "CoW copy",
    icon: "Copy",
    requires: { gitCheckout: true },
    policy: { pathKeys: "per-attempt" },

    async availability(context) {
      if (context.projectCheckout === null) {
        return {
          status: "unavailable",
          message: "This machine has no checkout of the project",
        };
      }
      try {
        const result = await host.call(
          "probe",
          { sourcePath: context.projectCheckout.path },
          { hostId: context.host.id, timeoutMs: PROBE_TIMEOUT_MS },
        );
        if (result.status === "supported") return { status: "available" };
        return { status: "unavailable", message: result.message };
      } catch (error) {
        return {
          status: "unavailable",
          message: `Could not probe reflink support: ${errorMessage(error)}`,
        };
      }
    },

    async create(context) {
      const operationId = `create#${context.pathKey}#${context.attempt}`;
      reports.set(operationId, context.report);
      try {
        const result = await host.call(
          "create",
          {
            operationId,
            sourcePath: context.projectCheckout.path,
            pathKey: context.pathKey,
            branchName: context.rebuild
              ? (context.previous?.environment.branchName ??
                context.suggestedBranchName)
              : context.suggestedBranchName,
            branchMode: context.rebuild ? "reuse-existing" : "reset",
            timeoutMs: CREATE_TIMEOUT_MS,
          },
          {
            hostId: context.host.id,
            signal: context.signal,
            timeoutMs: CREATE_TIMEOUT_MS,
          },
        );
        if (result.status === "failed") {
          return { status: "failed", failure: "terminal", message: result.message };
        }
        return {
          status: "created",
          path: result.path,
          ownsPath: true,
          ...(result.baseBranch === null
            ? {}
            : { mergeBaseBranch: result.baseBranch }),
        };
      } catch (error) {
        if (context.signal.aborted) throw error;
        return { status: "failed", failure: "transient", message: errorMessage(error) };
      } finally {
        reports.delete(operationId);
      }
    },

    async remove(context) {
      if (context.hostId === null) {
        return { status: "failed", message: "The copy's machine is unknown" };
      }
      const operationId = `remove#${context.pathKey}#${context.attempt}`;
      try {
        return await host.call(
          "remove",
          { operationId, pathKey: context.pathKey, path: context.path },
          {
            hostId: context.hostId,
            signal: context.signal,
            timeoutMs: REMOVE_TIMEOUT_MS,
          },
        );
      } catch (error) {
        if (context.signal.aborted) throw error;
        return { status: "failed", message: errorMessage(error) };
      }
    },
  });
}
