import { randomBytes } from "node:crypto";
import { mkdir, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { CommandError, run } from "./process.js";

/** statfs f_type magic numbers for filesystems with reflink support on Linux. */
const REFLINK_FILESYSTEMS: ReadonlyMap<number, string> = new Map([
  [0x9123683e, "btrfs"],
  [0x58465342, "xfs"],
  [0x2fc12fc1, "zfs"],
  [0xca451a4e, "bcachefs"],
]);

export async function describeFilesystem(target: string): Promise<string> {
  const stats = await statfs(target);
  return REFLINK_FILESYSTEMS.get(stats.type) ?? `0x${stats.type.toString(16)}`;
}

export type ProbeResult =
  | { status: "supported"; filesystem: string }
  | { status: "unsupported"; message: string };

/**
 * Definitive check: reflink one small file from the source directory into the
 * copy root. Filesystem magic alone cannot prove the two paths share a
 * superblock (Btrfs subvolumes report distinct device ids), so we try it.
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
    return { status: "supported", filesystem };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
