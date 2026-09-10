import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeReflink } from "./reflink.js";
import { makeTestRoot, removeTestRoot } from "./test-support.js";

describe("probeReflink", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTestRoot();
  });
  afterEach(async () => {
    await removeTestRoot(root);
  });

  it("reports support when source and copy root share a reflink filesystem", async () => {
    const source = path.join(root, "src");
    await mkdir(source);
    const result = await probeReflink({ sourcePath: source, copiesRoot: path.join(root, "copies") });
    expect(result).toEqual({ status: "supported", filesystem: "btrfs", mode: "reflink" });
    expect(await readdir(source)).toEqual([]);
    expect(await readdir(path.join(root, "copies"))).toEqual([]);
  });

  it("reports unsupported across filesystems", async () => {
    const source = path.join(root, "src");
    await mkdir(source);
    const otherFs = await mkdtemp(path.join(os.tmpdir(), "cow-probe-"));
    try {
      const result = await probeReflink({ sourcePath: source, copiesRoot: otherFs });
      expect(result.status).toBe("unsupported");
      if (result.status === "unsupported") {
        expect(result.message).toMatch(/not supported/);
      }
      expect(await readdir(source)).toEqual([]);
    } finally {
      await rm(otherFs, { recursive: true, force: true });
    }
  });

  it("reports unsupported for a missing source", async () => {
    const result = await probeReflink({
      sourcePath: path.join(root, "missing"),
      copiesRoot: path.join(root, "copies"),
    });
    expect(result.status).toBe("unsupported");
  });
});
