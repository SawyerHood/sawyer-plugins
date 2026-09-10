import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { PluginEnvironmentProviderDefinition } from "@get-bb/plugin-sdk/environment-provider";
import { describe, expect, it, vi } from "vitest";
import cowCopyPlugin from "./server.js";

type Definition = PluginEnvironmentProviderDefinition<{ gitCheckout: true }, undefined>;

async function load(callImpl: (method: string, input: unknown) => unknown) {
  const registered: Definition[] = [];
  let signalHandler: ((event: { hostId: string; payload: unknown }) => void) | undefined;
  const call = vi.fn(async (method: string, input: unknown) => callImpl(method, input));
  const bb = {
    hosts: {
      experimental_client: () => ({
        call,
        experimental_onSignal: (_name: string, handler: typeof signalHandler) => {
          signalHandler = handler;
          return () => {};
        },
        experimental_onWorkerExit: () => () => {},
      }),
    },
    experimental_environments: {
      register: (definition: Definition) => registered.push(definition),
      recheck: async () => {},
    },
  } as unknown as BbPluginApi;
  await cowCopyPlugin(bb);
  const definition = registered[0];
  if (definition === undefined) throw new Error("provider not registered");
  return { definition, call, emit: (payload: unknown) => signalHandler?.({ hostId: "h", payload }) };
}

const baseCreateContext = {
  project: { id: "p" },
  host: { id: "host_1" },
  projectCheckout: { path: "/src/repo" },
  gitRemote: null,
  inputs: null,
  thread: { id: "thr" },
  suggestedBranchName: "bb/suggested",
  attempt: 1,
  pathKey: "pk",
  rebuild: false,
  previous: null,
  experimental_claimPath: async () => true,
  signal: new AbortController().signal,
};

describe("cow copy provider", () => {
  it("registers with git checkout requirement and per-attempt paths", async () => {
    const { definition } = await load(() => ({ status: "supported", filesystem: "btrfs" }));
    expect(definition.id).toBe("btrfs-cow");
    expect(definition.requires).toEqual({ gitCheckout: true });
    expect(definition.policy).toEqual({ pathKeys: "per-attempt" });
  });

  it("maps the probe to availability", async () => {
    const { definition, call } = await load((method) =>
      method === "probe" ? { status: "unsupported", message: "nope" } : undefined,
    );
    const context = { project: { id: "p" }, host: { id: "host_1" }, projectCheckout: { path: "/src/repo" }, gitRemote: null };
    expect(await definition.availability?.(context as never)).toEqual({ status: "unavailable", message: "nope" });
    expect(call).toHaveBeenCalledWith("probe", { sourcePath: "/src/repo" }, expect.objectContaining({ hostId: "host_1" }));
  });

  it("creates with the suggested branch and forwards host progress", async () => {
    let emitDuringCreate: (() => void) | undefined;
    const { definition, call, emit } = await load((method) => {
      if (method === "create") {
        emitDuringCreate?.();
        return { status: "created", path: "/data/copies/pk/repo", baseBranch: "main", copyMs: 12 };
      }
      return undefined;
    });
    const report = { step: vi.fn(), log: vi.fn() };
    emitDuringCreate = () => emit({ operationId: "create#pk#1", kind: "step", text: "Copying" });
    const result = await definition.create({ ...baseCreateContext, report } as never);
    expect(result).toEqual({ status: "created", path: "/data/copies/pk/repo", ownsPath: true, mergeBaseBranch: "main" });
    expect(call).toHaveBeenCalledWith(
      "create",
      expect.objectContaining({ sourcePath: "/src/repo", pathKey: "pk", branchName: "bb/suggested", branchMode: "reset" }),
      expect.objectContaining({ hostId: "host_1" }),
    );
    expect(report.step).toHaveBeenCalledWith("Copying");
  });

  it("reuses the previous branch on rebuild", async () => {
    const { definition, call } = await load(() => ({ status: "created", path: "/p", baseBranch: null, copyMs: 0 }));
    const result = await definition.create({
      ...baseCreateContext,
      rebuild: true,
      previous: { environment: { branchName: "bb/old" }, resource: null },
      report: { step() {}, log() {} },
    } as never);
    expect(result).toEqual({ status: "created", path: "/p", ownsPath: true });
    expect(call).toHaveBeenCalledWith("create", expect.objectContaining({ branchName: "bb/old", branchMode: "reuse-existing" }), expect.anything());
  });

  it("treats host failures as terminal and transport errors as transient", async () => {
    const terminal = await load(() => ({ status: "failed", message: "bad source" }));
    expect(await terminal.definition.create({ ...baseCreateContext, report: { step() {}, log() {} } } as never)).toEqual({
      status: "failed",
      failure: "terminal",
      message: "bad source",
    });
    const transient = await load(() => {
      throw new Error("host offline");
    });
    expect(await transient.definition.create({ ...baseCreateContext, report: { step() {}, log() {} } } as never)).toEqual({
      status: "failed",
      failure: "transient",
      message: "host offline",
    });
  });

  it("removes through the host and fails without a host id", async () => {
    const { definition, call } = await load(() => ({ status: "removed" }));
    const removeContext = { environment: null, path: "/p", pathKey: "pk", resource: null, attempt: 1, report: { step() {}, log() {} }, signal: new AbortController().signal };
    expect(await definition.remove({ ...removeContext, hostId: "host_1" } as never)).toEqual({ status: "removed" });
    expect(call).toHaveBeenCalledWith("remove", { operationId: "remove#pk#1", pathKey: "pk", path: "/p" }, expect.objectContaining({ hostId: "host_1" }));
    expect((await definition.remove({ ...removeContext, hostId: null } as never)).status).toBe("failed");
  });
});
