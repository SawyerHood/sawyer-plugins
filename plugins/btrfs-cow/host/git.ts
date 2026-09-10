import { stat } from "node:fs/promises";
import path from "node:path";
import { run } from "./process.js";

interface GitOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}

export async function git(
  args: readonly string[],
  cwd: string,
  options: GitOptions & { allowFailure?: boolean | undefined } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return run("git", args, { cwd, ...options });
}

export type RepositoryState =
  | "not_git"
  | "linked_worktree"
  | "no_commits"
  | "has_commits";

/**
 * A reflink copy duplicates `.git` verbatim, so the source must own a real
 * `.git` directory. A linked worktree has a `.git` file pointing elsewhere and
 * its copy would share (and corrupt) the parent's worktree metadata.
 */
export async function readRepositoryState(
  sourcePath: string,
  options: GitOptions = {},
): Promise<RepositoryState> {
  let dotGit;
  try {
    dotGit = await stat(path.join(sourcePath, ".git"));
  } catch {
    return "not_git";
  }
  if (!dotGit.isDirectory()) return "linked_worktree";
  const head = await git(["rev-parse", "--verify", "-q", "HEAD"], sourcePath, {
    ...options,
    allowFailure: true,
  });
  return head.exitCode === 0 ? "has_commits" : "no_commits";
}

/** Current branch name, or null when HEAD is detached. */
export async function currentBranch(
  cwd: string,
  options: GitOptions = {},
): Promise<string | null> {
  const result = await git(["symbolic-ref", "--short", "-q", "HEAD"], cwd, {
    ...options,
    allowFailure: true,
  });
  if (result.exitCode !== 0) return null;
  const name = result.stdout.trim();
  return name === "" ? null : name;
}

export async function hasLocalBranch(
  cwd: string,
  branch: string,
  options: GitOptions = {},
): Promise<boolean> {
  const result = await git(
    ["show-ref", "--verify", "-q", `refs/heads/${branch}`],
    cwd,
    { ...options, allowFailure: true },
  );
  return result.exitCode === 0;
}
