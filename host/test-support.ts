import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "./process.js";

/**
 * Reflink tests must run on a reflink-capable filesystem. os.tmpdir() is often
 * tmpfs, so default to a cache directory in $HOME; override with
 * BB_COW_TEST_ROOT.
 */
export async function makeTestRoot(): Promise<string> {
  const base =
    process.env.BB_COW_TEST_ROOT ??
    path.join(os.homedir(), ".cache", "bb-plugin-btrfs-cow-tests");
  await mkdir(base, { recursive: true });
  return mkdtemp(path.join(base, "t-"));
}

export async function removeTestRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

const gitEnv = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

export async function git(args: string[], cwd: string): Promise<string> {
  const result = await run("git", args, { cwd, env: gitEnv });
  return result.stdout.trim();
}

/** A repo on `main` with one commit, an ignored build dir, and a dirty file. */
export async function makeSourceRepo(root: string, name = "my-repo"): Promise<string> {
  const repo = path.join(root, name);
  await mkdir(repo, { recursive: true });
  await git(["init", "-q", "-b", "main"], repo);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  await writeFile(path.join(repo, ".gitignore"), "node_modules/\n");
  await git(["add", "."], repo);
  await git(["commit", "-q", "-m", "init"], repo);
  await mkdir(path.join(repo, "node_modules", "dep"), { recursive: true });
  await writeFile(path.join(repo, "node_modules", "dep", "index.js"), "// dep\n");
  await writeFile(path.join(repo, "dirty.txt"), "uncommitted\n");
  return repo;
}
