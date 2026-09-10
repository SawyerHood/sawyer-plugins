import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCowHostEntry } from "./host.js";
import type { CowProgress } from "./contract.js";
import { makeSourceRepo, makeTestRoot, removeTestRoot } from "./host/test-support.js";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function makeContext(dataDir: string, signals: CowProgress[] = []) {
  return {
    signal: new AbortController().signal,
    experimental_paths: { dataDir, tmpDir: path.join(dataDir, "tmp") },
    experimental_emitSignal: async (_name: "progress", payload: CowProgress) => {
      signals.push(payload);
    },
    experimental_watch: async () => {
      throw new Error("not used");
    },
    experimental_retainWorker: () => {
      throw new Error("not used");
    },
  } as unknown as Parameters<ReturnType<typeof createCowHostEntry>["handlers"]["create"]>[1];
}

describe("host entry", () => {
  let root: string;
  let dataDir: string;
  let source: string;
  const entry = createCowHostEntry();
  beforeEach(async () => {
    root = await makeTestRoot();
    dataDir = path.join(root, "data");
    await mkdir(dataDir);
    source = await makeSourceRepo(root);
  });
  afterEach(async () => {
    await removeTestRoot(root);
  });

  it("probes support", async () => {
    const result = await entry.handlers.probe({ sourcePath: source }, makeContext(dataDir));
    expect(result).toEqual({ status: "supported", filesystem: "btrfs" });
  });

  it("creates under copies/<pathKey>/<repo> and streams progress", async () => {
    const signals: CowProgress[] = [];
    const result = await entry.handlers.create(
      {
        operationId: "op1",
        sourcePath: source,
        pathKey: "key1",
        branchName: "bb/thread",
        branchMode: "reset",
        timeoutMs: 60_000,
      },
      makeContext(dataDir, signals),
    );
    expect(result).toMatchObject({
      status: "created",
      path: path.join(dataDir, "copies", "key1", "my-repo"),
      baseBranch: "main",
    });
    expect(signals.map((s) => s.kind)).toContain("step");
    expect(signals.every((s) => s.operationId === "op1")).toBe(true);
  });

  it("returns failed for a bad source instead of throwing", async () => {
    const result = await entry.handlers.create(
      {
        operationId: "op2",
        sourcePath: path.join(root, "missing"),
        pathKey: "key2",
        branchName: "b",
        branchMode: "reset",
        timeoutMs: 60_000,
      },
      makeContext(dataDir),
    );
    expect(result.status).toBe("failed");
  });

  it("removes by explicit path and by path key when the path is unknown", async () => {
    const context = makeContext(dataDir);
    const input = { operationId: "op", sourcePath: source, branchName: "b", branchMode: "reset" as const, timeoutMs: 60_000 };
    const a = await entry.handlers.create({ ...input, pathKey: "ka" }, context);
    const b = await entry.handlers.create({ ...input, pathKey: "kb" }, context);
    if (a.status !== "created" || b.status !== "created") throw new Error("setup failed");

    expect(await entry.handlers.remove({ operationId: "r", pathKey: "ka", path: a.path }, context)).toEqual({ status: "removed" });
    expect(await exists(a.path)).toBe(false);
    expect(await exists(path.dirname(a.path))).toBe(false);

    expect(await entry.handlers.remove({ operationId: "r", pathKey: "kb", path: null }, context)).toEqual({ status: "removed" });
    expect(await exists(b.path)).toBe(false);

    expect(await entry.handlers.remove({ operationId: "r", pathKey: "never", path: null }, context)).toEqual({ status: "removed" });
  });

  it("refuses to remove a path outside its copy root", async () => {
    const result = await entry.handlers.remove(
      { operationId: "r", pathKey: "k", path: source },
      makeContext(dataDir),
    );
    expect(result.status).toBe("failed");
    expect(await exists(path.join(source, "README.md"))).toBe(true);
  });
});
