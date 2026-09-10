import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCopy, removeCopy } from "./copy.js";
import { run } from "./process.js";
import {
  canDeleteSubvolumes,
  ConvertError,
  convertToSubvolume,
  deleteSubvolume,
  isSubvolume,
  probeReflink,
} from "./reflink.js";
import { git, makeSourceRepo, makeTestRoot, removeTestRoot } from "./test-support.js";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

describe("subvolume detection and conversion", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTestRoot();
  });
  afterEach(async () => {
    await removeTestRoot(root);
  });

  it("distinguishes subvolumes from plain directories", async () => {
    const plain = path.join(root, "plain");
    await mkdir(plain);
    const subvol = path.join(root, "subvol");
    await run("btrfs", ["subvolume", "create", subvol]);
    expect(await isSubvolume(plain)).toBe(false);
    expect(await isSubvolume(subvol)).toBe(true);
    expect(await isSubvolume(path.join(root, "missing"))).toBe(false);
  });

  it("converts a checkout in place, keeping contents, git state, and the path", async () => {
    const source = await makeSourceRepo(root);
    const headBefore = await git(["rev-parse", "HEAD"], source);
    await convertToSubvolume({ path: source });
    expect(await isSubvolume(source)).toBe(true);
    expect(await git(["rev-parse", "HEAD"], source)).toBe(headBefore);
    expect(await git(["status", "--short"], source)).toContain("dirty.txt");
    expect(await readFile(path.join(source, "node_modules", "dep", "index.js"), "utf8")).toBe("// dep\n");
    expect(await exists(`${source}.bb-subvol-new`)).toBe(false);
    expect(await exists(`${source}.bb-subvol-old`)).toBe(false);
  });

  it("refuses to convert a subvolume, a file, or a missing path", async () => {
    const source = await makeSourceRepo(root);
    await convertToSubvolume({ path: source });
    await expect(convertToSubvolume({ path: source })).rejects.toThrowError(ConvertError);
    await expect(convertToSubvolume({ path: path.join(source, "README.md") })).rejects.toThrowError(ConvertError);
    await expect(convertToSubvolume({ path: path.join(root, "nope") })).rejects.toThrowError(ConvertError);
  });

  it("deletes a non-empty subvolume one way or another", async () => {
    const subvol = path.join(root, "subvol");
    await run("btrfs", ["subvolume", "create", subvol]);
    await writeFile(path.join(subvol, "file"), "x\n");
    const method = await deleteSubvolume({ path: subvol });
    expect(["btrfs", "rm"]).toContain(method);
    expect(await exists(subvol)).toBe(false);
    expect(typeof (await canDeleteSubvolumes(path.join(root, "probe-root")))).toBe("boolean");
  });
});

describe("snapshot mode", () => {
  let root: string;
  let source: string;
  let target: string;
  beforeEach(async () => {
    root = await makeTestRoot();
    source = await makeSourceRepo(root);
    await convertToSubvolume({ path: source });
    target = path.join(root, "copies", "key1", "my-repo");
  });
  afterEach(async () => {
    await removeTestRoot(root);
  });

  it("probes as snapshot mode", async () => {
    const result = await probeReflink({ sourcePath: source, copiesRoot: path.join(root, "copies") });
    expect(result).toEqual({ status: "supported", filesystem: "btrfs", mode: "snapshot" });
  });

  it("snapshots the checkout and creates the branch", async () => {
    const steps: string[] = [];
    const result = await createCopy({
      sourcePath: source,
      targetPath: target,
      branchName: "feature/snap",
      branchMode: "reset",
      timeoutMs: 60_000,
      progress: { step: (t) => steps.push(t), log: () => {} },
    });
    expect(result).toMatchObject({ path: target, baseBranch: "main", mode: "snapshot", reused: false });
    expect(await isSubvolume(target)).toBe(true);
    expect(steps[0]).toBe("Snapshotting checkout");
    expect(await git(["rev-parse", "--abbrev-ref", "HEAD"], target)).toBe("feature/snap");
    expect(await readFile(path.join(target, "node_modules", "dep", "index.js"), "utf8")).toBe("// dep\n");
    expect(await git(["rev-parse", "--abbrev-ref", "HEAD"], source)).toBe("main");
  });

  it("keeps the snapshot and the source independent", async () => {
    await createCopy({ sourcePath: source, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 });
    await writeFile(path.join(target, "README.md"), "changed in snapshot\n");
    await writeFile(path.join(source, "README.md"), "changed in source\n");
    expect(await readFile(path.join(target, "README.md"), "utf8")).toBe("changed in snapshot\n");
    expect(await readFile(path.join(source, "README.md"), "utf8")).toBe("changed in source\n");
  });

  it("is idempotent and removes the snapshot cleanly", async () => {
    await createCopy({ sourcePath: source, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 });
    const again = await createCopy({ sourcePath: source, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 });
    expect(again).toMatchObject({ reused: true, mode: "snapshot" });
    expect(await removeCopy({ path: target, pruneEmptyParent: true })).toBe(true);
    expect(await exists(target)).toBe(false);
    expect(await exists(path.dirname(target))).toBe(false);
    expect(await isSubvolume(source)).toBe(true);
    expect(await exists(path.join(source, "README.md"))).toBe(true);
  });
});
