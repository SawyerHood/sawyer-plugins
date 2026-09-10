import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { CommandError, run } from "./process.js";

/** statfs f_type magic numbers for filesystems with reflink support on Linux. */
const REFLINK_FILESYSTEMS: ReadonlyMap<number, string> = new Map([
  [0x9123683e, "btrfs"],
  [0x58465342, "xfs"],
  [0x2fc12fc1, "zfs"],
  [0xca451a4e, "bcachefs"],
]);

/** Every Btrfs subvolume root has this inode number. */
const BTRFS_SUBVOLUME_ROOT_INODE = 256;

export type CopyMode = "snapshot" | "reflink";

export async function describeFilesystem(target: string): Promise<string> {
  const stats = await statfs(target);
  return REFLINK_FILESYSTEMS.get(stats.type) ?? `0x${stats.type.toString(16)}`;
}

export async function isBtrfs(target: string): Promise<boolean> {
  try {
    return (await describeFilesystem(target)) === "btrfs";
  } catch {
    return false;
  }
}

/** True when `target` is the root of a Btrfs subvolume (or snapshot). */
export async function isSubvolume(target: string): Promise<boolean> {
  try {
    const stats = await stat(target);
    return (
      stats.isDirectory() &&
      stats.ino === BTRFS_SUBVOLUME_ROOT_INODE &&
      (await isBtrfs(target))
    );
  } catch {
    return false;
  }
}

export type ProbeResult =
  | { status: "supported"; filesystem: string; mode: CopyMode }
  | { status: "unsupported"; message: string };

/**
 * Definitive check: reflink one small file from the source directory into the
 * copy root. Filesystem magic alone cannot prove the two paths share a
 * superblock (Btrfs subvolumes report distinct device ids), so we try it.
 * A source that is itself a subvolume will be snapshotted instead.
 */
export async function probeReflink(args: {
  sourcePath: string;
  copiesRoot: string;
}): Promise<ProbeResult> {
  let filesystem: string;
  try {
    filesystem = await describeFilesystem(args.sourcePath);
  } catch (error) {
    return {
      status: "unsupported",
      message: `Cannot inspect ${args.sourcePath}: ${errorMessage(error)}`,
    };
  }
  await mkdir(args.copiesRoot, { recursive: true });
  const token = randomBytes(6).toString("hex");
  const sourceProbe = path.join(args.sourcePath, `.bb-cow-probe-${token}`);
  const targetProbe = path.join(args.copiesRoot, `.bb-cow-probe-${token}`);
  try {
    await writeFile(sourceProbe, "probe\n");
    await run("cp", ["--reflink=always", sourceProbe, targetProbe]);
  } catch (error) {
    const detail =
      error instanceof CommandError
        ? error.result.stderr.trim() || error.message
        : errorMessage(error);
    return {
      status: "unsupported",
      message: `Reflink copies from ${args.sourcePath} (${filesystem}) to ${args.copiesRoot} are not supported: ${detail}`,
    };
  } finally {
    await rm(sourceProbe, { force: true });
    await rm(targetProbe, { force: true });
  }
  const mode: CopyMode = (await isSubvolume(args.sourcePath))
    ? "snapshot"
    : "reflink";
  return { status: "supported", filesystem, mode };
}

/** Copy a directory tree with reflinks; fails instead of falling back to a byte copy. */
export async function reflinkCopyTree(args: {
  sourcePath: string;
  targetPath: string;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  await mkdir(path.dirname(args.targetPath), { recursive: true });
  await run(
    "cp",
    ["-a", "--reflink=always", "--", args.sourcePath, args.targetPath],
    { timeoutMs: args.timeoutMs, signal: args.signal },
  );
}

/** Snapshot a subvolume; constant time regardless of tree size. */
export async function snapshotSubvolume(args: {
  sourcePath: string;
  targetPath: string;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  await mkdir(path.dirname(args.targetPath), { recursive: true });
  await run(
    "btrfs",
    ["subvolume", "snapshot", "--", args.sourcePath, args.targetPath],
    { timeoutMs: args.timeoutMs, signal: args.signal },
  );
}

export type SubvolumeDeleteMethod = "btrfs" | "rm";

/**
 * Delete a subvolume. `btrfs subvolume delete` is instant but needs root or
 * the `user_subvol_rm_allowed` mount option; otherwise empty it with rm and
 * remove the empty shell, which any owner may do.
 */
export async function deleteSubvolume(args: {
  path: string;
  signal?: AbortSignal | undefined;
}): Promise<SubvolumeDeleteMethod> {
  const result = await run("btrfs", ["subvolume", "delete", "--", args.path], {
    allowFailure: true,
    signal: args.signal,
  });
  if (result.exitCode === 0) return "btrfs";
  await rm(args.path, { recursive: true, force: true });
  return "rm";
}

/** Whether this user can delete a non-empty subvolume under `root` instantly. */
export async function canDeleteSubvolumes(root: string): Promise<boolean> {
  await mkdir(root, { recursive: true });
  const probe = path.join(root, `.bb-cow-subvol-probe-${randomBytes(6).toString("hex")}`);
  try {
    await run("btrfs", ["subvolume", "create", "--", probe]);
    await writeFile(path.join(probe, "probe"), "probe\n");
    const result = await run("btrfs", ["subvolume", "delete", "--", probe], {
      allowFailure: true,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
}

export class ConvertError extends Error {}

/**
 * Replace a plain directory with a subvolume holding the same contents.
 * Contents are reflinked into a sibling subvolume, then the two are swapped
 * by rename so the original path keeps its name. The old directory is removed
 * last; a failure before the swap leaves the original untouched.
 */
export async function convertToSubvolume(args: {
  path: string;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  const target = path.resolve(args.path);
  let stats;
  try {
    stats = await stat(target);
  } catch {
    throw new ConvertError(`${target} does not exist`);
  }
  if (!stats.isDirectory()) throw new ConvertError(`${target} is not a directory`);
  if (!(await isBtrfs(target))) {
    throw new ConvertError(`${target} is not on a Btrfs filesystem`);
  }
  if (await isSubvolume(target)) {
    throw new ConvertError(`${target} is already a subvolume`);
  }
  const fresh = `${target}.bb-subvol-new`;
  const old = `${target}.bb-subvol-old`;
  for (const stale of [fresh, old]) {
    if (await exists(stale)) {
      throw new ConvertError(
        `${stale} already exists; remove it before converting`,
      );
    }
  }
  try {
    await run("btrfs", ["subvolume", "create", "--", fresh], {
      signal: args.signal,
    });
    await run(
      "cp",
      ["-a", "--reflink=always", "--", `${target}/.`, `${fresh}/`],
      { timeoutMs: args.timeoutMs, signal: args.signal },
    );
  } catch (error) {
    await rm(fresh, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  await rename(target, old);
  try {
    await rename(fresh, target);
  } catch (error) {
    await rename(old, target).catch(() => {});
    throw error;
  }
  await rm(old, { recursive: true, force: true });
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
