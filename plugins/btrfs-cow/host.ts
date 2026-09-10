import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { cowHostContract, cowHostSignals, type CowProgress } from "./contract.js";
import { createCopy, removeCopy, type Progress } from "./host/copy.js";
import {
  assertRemovablePath,
  resolveAttemptRoot,
  resolveCopiesRoot,
  resolveTargetPath,
} from "./host/paths.js";
import {
  canDeleteSubvolumes,
  convertToSubvolume,
  describeFilesystem,
  isBtrfs,
  isSubvolume,
  probeReflink,
} from "./host/reflink.js";
import { stat } from "node:fs/promises";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function copiesForPathKey(args: {
  dataDir: string;
  pathKey: string;
}): Promise<string[]> {
  const root = resolveAttemptRoot(args);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function createCowHostEntry() {
  return experimental_defineHostEntry({
    contract: cowHostContract,
    experimental_signals: cowHostSignals,
    handlers: {
      async probe(input, context) {
        try {
          return await probeReflink({
            sourcePath: input.sourcePath,
            copiesRoot: resolveCopiesRoot(context.experimental_paths.dataDir),
          });
        } catch (error) {
          return { status: "unsupported", message: errorMessage(error) } as const;
        }
      },

      async create(input, context) {
        const emit = (kind: CowProgress["kind"], text: string) => {
          void context.experimental_emitSignal("progress", {
            operationId: input.operationId,
            kind,
            text,
          });
        };
        const progress: Progress = {
          step: (text) => emit("step", text),
          log: (text) => emit("log", text),
        };
        try {
          const targetPath = resolveTargetPath({
            dataDir: context.experimental_paths.dataDir,
            pathKey: input.pathKey,
            sourcePath: input.sourcePath,
          });
          const created = await createCopy({
            sourcePath: input.sourcePath,
            targetPath,
            branchName: input.branchName,
            branchMode: input.branchMode,
            timeoutMs: input.timeoutMs,
            progress,
            signal: context.signal,
          });
          return {
            status: "created",
            path: created.path,
            baseBranch: created.baseBranch,
            mode: created.mode,
            copyMs: created.copyMs,
          } as const;
        } catch (error) {
          if (context.signal.aborted) throw error;
          return { status: "failed", message: errorMessage(error) } as const;
        }
      },

      async status(input, context) {
        const target = path.resolve(input.path);
        const copiesRoot = resolveCopiesRoot(context.experimental_paths.dataDir);
        let exists = false;
        try {
          exists = (await stat(target)).isDirectory();
        } catch {}
        if (!exists) {
          return {
            path: target,
            exists: false,
            filesystem: null,
            isSubvolume: false,
            reflinkSupported: false,
            reflinkMessage: `${target} is not a directory`,
            subvolumeDeleteAllowed: null,
            mode: null,
          };
        }
        const filesystem = await describeFilesystem(target).catch(() => null);
        const probe = await probeReflink({ sourcePath: target, copiesRoot });
        const btrfs = await isBtrfs(target);
        return {
          path: target,
          exists: true,
          filesystem,
          isSubvolume: await isSubvolume(target),
          reflinkSupported: probe.status === "supported",
          reflinkMessage: probe.status === "supported" ? null : probe.message,
          subvolumeDeleteAllowed: btrfs ? await canDeleteSubvolumes(copiesRoot) : null,
          mode: probe.status === "supported" ? probe.mode : null,
        };
      },

      async convert(input, context) {
        try {
          await convertToSubvolume({
            path: input.path,
            timeoutMs: input.timeoutMs,
            signal: context.signal,
          });
          return { status: "converted", path: path.resolve(input.path) } as const;
        } catch (error) {
          if (context.signal.aborted) throw error;
          return { status: "failed", message: errorMessage(error) } as const;
        }
      },

      async remove(input, context) {
        const dataDir = context.experimental_paths.dataDir;
        try {
          const paths =
            input.path === null
              ? await copiesForPathKey({ dataDir, pathKey: input.pathKey })
              : [assertRemovablePath({ dataDir, path: input.path })];
          for (const target of paths) {
            await removeCopy({
              path: target,
              pruneEmptyParent: true,
              signal: context.signal,
            });
          }
          return { status: "removed" } as const;
        } catch (error) {
          if (context.signal.aborted) throw error;
          return { status: "failed", message: errorMessage(error) } as const;
        }
      },
    },
  });
}

export default createCowHostEntry();
