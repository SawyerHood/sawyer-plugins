import { experimental_killProcessesWithCwdUnder } from "@get-bb/plugin-sdk/host";
import { access, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { currentBranch, git, hasLocalBranch, readRepositoryState } from "./git.js";
import { CancelledError, throwIfAborted } from "./process.js";
import { reflinkCopyTree } from "./reflink.js";

export type BranchMode = "reset" | "reuse-existing";

export interface Progress {
  step(text: string): void;
  log(text: string): void;
}

export class CowCopyError extends Error {}

export function completionPathFor(targetPath: string): string {
  return `${targetPath}.completed`;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function readCompletion(
  completionPath: string,
): Promise<{ branch: string; baseBranch: string | null } | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(completionPath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "branch" in parsed &&
      typeof parsed.branch === "string"
    ) {
      const baseBranch =
        "baseBranch" in parsed && typeof parsed.baseBranch === "string"
          ? parsed.baseBranch
          : null;
      return { branch: parsed.branch, baseBranch };
    }
  } catch {}
  return null;
}

async function removeDirectoryIfEmpty(target: string): Promise<void> {
  try {
    await rmdir(target);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? String(error.code) : "";
    if (["ENOENT", "ENOTEMPTY", "EEXIST", "EBUSY"].includes(code)) return;
    throw error;
  }
}

export interface CreateCopyArgs {
  sourcePath: string;
  targetPath: string;
  branchName: string;
  branchMode: BranchMode;
  timeoutMs: number;
  progress?: Progress | undefined;
  signal?: AbortSignal | undefined;
}

export interface CreateCopyResult {
  path: string;
  baseBranch: string | null;
  copyMs: number;
  reused: boolean;
}

/**
 * Idempotent for the target path: a completed copy already on the requested
 * branch is returned as-is (core re-calls create after restarts); anything
 * else at the target is discarded and rebuilt.
 */
export async function createCopy(args: CreateCopyArgs): Promise<CreateCopyResult> {
  throwIfAborted(args.signal);
  const completionPath = completionPathFor(args.targetPath);
  const completed = await readCompletion(completionPath);
  if (
    completed !== null &&
    completed.branch === args.branchName &&
    (await exists(args.targetPath)) &&
    (await currentBranch(args.targetPath, { signal: args.signal })) ===
      args.branchName
  ) {
    args.progress?.log(`Reusing completed copy at ${args.targetPath}`);
    return {
      path: args.targetPath,
      baseBranch: completed.baseBranch,
      copyMs: 0,
      reused: true,
    };
  }

  await removeCopy({ path: args.targetPath, signal: args.signal });

  throwIfAborted(args.signal);
  switch (await readRepositoryState(args.sourcePath, { signal: args.signal })) {
    case "not_git":
      throw new CowCopyError(
        `Cannot copy ${args.sourcePath}: it is not a Git repository.`,
      );
    case "linked_worktree":
      throw new CowCopyError(
        `Cannot copy ${args.sourcePath}: it is a linked Git worktree (its .git is a file). Copy from a checkout that owns its .git directory.`,
      );
    case "no_commits":
      throw new CowCopyError(
        `Cannot copy ${args.sourcePath}: the repository has no commits yet.`,
      );
    case "has_commits":
      break;
  }

  const baseBranch = await currentBranch(args.sourcePath, { signal: args.signal });

  args.progress?.step("Reflink-copying checkout");
  const startedAt = Date.now();
  try {
    await reflinkCopyTree({
      sourcePath: args.sourcePath,
      targetPath: args.targetPath,
      timeoutMs: args.timeoutMs,
      signal: args.signal,
    });
    const copyMs = Date.now() - startedAt;
    args.progress?.log(`Copied ${args.sourcePath} in ${copyMs}ms`);

    throwIfAborted(args.signal);
    const reuse =
      args.branchMode === "reuse-existing" &&
      (await hasLocalBranch(args.targetPath, args.branchName, {
        signal: args.signal,
      }));
    args.progress?.step(
      reuse
        ? `Checking out existing branch ${args.branchName}`
        : `Creating branch ${args.branchName}`,
    );
    // Uncommitted changes in the source are carried into the copy on purpose;
    // switching branches with -B/-b keeps the working tree as copied.
    await git(
      reuse
        ? ["checkout", "--quiet", args.branchName]
        : ["checkout", "--quiet", "-B", args.branchName],
      args.targetPath,
      { signal: args.signal, timeoutMs: args.timeoutMs },
    );
    await writeFile(
      completionPath,
      `${JSON.stringify({ branch: args.branchName, baseBranch })}\n`,
      "utf8",
    );
    return { path: args.targetPath, baseBranch, copyMs, reused: false };
  } catch (error) {
    if (!(error instanceof CancelledError)) {
      await removeCopy({ path: args.targetPath }).catch(() => {});
    }
    throw error;
  }
}

export async function removeCopy(args: {
  path: string;
  pruneEmptyParent?: boolean | undefined;
  signal?: AbortSignal | undefined;
}): Promise<boolean> {
  throwIfAborted(args.signal);
  const target = path.resolve(args.path);
  await rm(completionPathFor(target), { force: true });
  const existed = await exists(target);
  if (existed) {
    await experimental_killProcessesWithCwdUnder({ directory: target });
    await rm(target, { recursive: true, force: true });
  }
  if (args.pruneEmptyParent) await removeDirectoryIfEmpty(path.dirname(target));
  return existed;
}
