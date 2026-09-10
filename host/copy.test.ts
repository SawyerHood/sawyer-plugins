import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { completionPathFor, CowCopyError, createCopy, removeCopy } from "./copy.js";
import { git, makeSourceRepo, makeTestRoot, removeTestRoot } from "./test-support.js";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

describe("createCopy", () => {
  let root: string;
  let source: string;
  let target: string;
  beforeEach(async () => {
    root = await makeTestRoot();
    source = await makeSourceRepo(root);
    target = path.join(root, "copies", "key1", "my-repo");
  });
  afterEach(async () => {
    await removeTestRoot(root);
  });

  it("reflink-copies the checkout, carries ignored and dirty files, and creates the branch", async () => {
    const steps: string[] = [];
    const result = await createCopy({
      sourcePath: source,
      targetPath: target,
      branchName: "feature/one",
      branchMode: "reset",
      timeoutMs: 60_000,
      progress: { step: (t) => steps.push(t), log: () => {} },
    });
    expect(result).toMatchObject({ path: target, baseBranch: "main", mode: "reflink", reused: false });
    expect(await git(["rev-parse", "--abbrev-ref", "HEAD"], target)).toBe("feature/one");
    expect(await git(["rev-parse", "HEAD"], target)).toBe(await git(["rev-parse", "HEAD"], source));
    expect(await readFile(path.join(target, "node_modules", "dep", "index.js"), "utf8")).toBe("// dep\n");
    expect(await readFile(path.join(target, "dirty.txt"), "utf8")).toBe("uncommitted\n");
    expect(JSON.parse(await readFile(completionPathFor(target), "utf8"))).toEqual({
      branch: "feature/one",
      baseBranch: "main",
      mode: "reflink",
    });
    expect(steps).toEqual(["Reflink-copying checkout", "Creating branch feature/one"]);
    // The source is untouched: still on main, no new branch.
    expect(await git(["rev-parse", "--abbrev-ref", "HEAD"], source)).toBe("main");
    expect(await git(["branch", "--list", "feature/one"], source)).toBe("");
  });

  it("gives the copy independent data and independent git state", async () => {
    await createCopy({ sourcePath: source, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 });
    await writeFile(path.join(target, "README.md"), "changed in copy\n");
    await git(["commit", "-q", "-am", "copy commit"], target);
    expect(await readFile(path.join(source, "README.md"), "utf8")).toBe("hello\n");
    expect(await git(["log", "--oneline"], source)).not.toContain("copy commit");
    expect(await git(["log", "--oneline"], target)).toContain("copy commit");
  });

  it("is idempotent for a completed copy on the requested branch", async () => {
    await createCopy({ sourcePath: source, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 });
    await writeFile(path.join(target, "marker.txt"), "keep me\n");
    const again = await createCopy({ sourcePath: source, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 });
    expect(again.reused).toBe(true);
    expect(await exists(path.join(target, "marker.txt"))).toBe(true);
  });

  it("rebuilds a partial target that has no completion marker", async () => {
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "junk.txt"), "partial\n");
    const result = await createCopy({ sourcePath: source, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 });
    expect(result.reused).toBe(false);
    expect(await exists(path.join(target, "junk.txt"))).toBe(false);
    expect(await exists(path.join(target, "README.md"))).toBe(true);
  });

  it("checks out an existing branch in reuse-existing mode", async () => {
    await git(["branch", "existing"], source);
    await createCopy({ sourcePath: source, targetPath: target, branchName: "existing", branchMode: "reuse-existing", timeoutMs: 60_000 });
    expect(await git(["rev-parse", "--abbrev-ref", "HEAD"], target)).toBe("existing");
  });

  it("reports a null base branch when the source HEAD is detached", async () => {
    await git(["checkout", "-q", "--detach"], source);
    const result = await createCopy({ sourcePath: source, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 });
    expect(result.baseBranch).toBeNull();
    expect(await git(["rev-parse", "--abbrev-ref", "HEAD"], target)).toBe("b");
  });

  it.each([
    ["not a git repo", async (dir: string) => { await mkdir(dir, { recursive: true }); }, /not a Git repository/],
    ["no commits", async (dir: string) => { await mkdir(dir, { recursive: true }); await git(["init", "-q"], dir); }, /no commits/],
  ])("rejects a source that is %s", async (_label, setup, message) => {
    const bad = path.join(root, "bad");
    await setup(bad);
    await expect(
      createCopy({ sourcePath: bad, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 }),
    ).rejects.toThrowError(message);
    expect(await exists(target)).toBe(false);
  });

  it("rejects a linked worktree as the source", async () => {
    const worktree = path.join(root, "wt");
    await git(["worktree", "add", "-q", worktree, "-b", "wt-branch"], source);
    await expect(
      createCopy({ sourcePath: worktree, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 }),
    ).rejects.toThrowError(CowCopyError);
  });
});

describe("removeCopy", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTestRoot();
  });
  afterEach(async () => {
    await removeTestRoot(root);
  });

  it("removes the copy, its marker, and an empty parent", async () => {
    const source = await makeSourceRepo(root);
    const target = path.join(root, "copies", "key1", "my-repo");
    await createCopy({ sourcePath: source, targetPath: target, branchName: "b", branchMode: "reset", timeoutMs: 60_000 });
    expect(await removeCopy({ path: target, pruneEmptyParent: true })).toBe(true);
    expect(await exists(target)).toBe(false);
    expect(await exists(completionPathFor(target))).toBe(false);
    expect(await exists(path.dirname(target))).toBe(false);
    expect(await exists(path.join(source, "README.md"))).toBe(true);
  });

  it("is a no-op for a missing path", async () => {
    expect(await removeCopy({ path: path.join(root, "nope") })).toBe(false);
  });
});
