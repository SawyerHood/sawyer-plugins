import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const failed = z
  .object({ status: z.literal("failed"), message: z.string().min(1) })
  .strict();

export const copyModeSchema = z.enum(["snapshot", "reflink"]);

export const cowHostContract = defineRpcContract({
  /** Check that source and the plugin's copy root support reflink copies. */
  probe: {
    input: z.object({ sourcePath: z.string().min(1) }).strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("supported"),
          filesystem: z.string().min(1),
          mode: copyModeSchema,
        })
        .strict(),
      z
        .object({
          status: z.literal("unsupported"),
          message: z.string().min(1),
        })
        .strict(),
    ]),
  },
  create: {
    input: z
      .object({
        operationId: z.string().min(1),
        sourcePath: z.string().min(1),
        pathKey: z.string().min(1),
        branchName: z.string().min(1),
        branchMode: z.enum(["reset", "reuse-existing"]),
        timeoutMs: z.number().int().positive(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("created"),
          path: z.string().min(1),
          baseBranch: z.string().min(1).nullable(),
          mode: copyModeSchema,
          copyMs: z.number().int().nonnegative(),
        })
        .strict(),
      failed,
    ]),
  },
  /** Detailed report for `bb btrfs-cow status`. */
  status: {
    input: z.object({ path: z.string().min(1) }).strict(),
    output: z
      .object({
        path: z.string().min(1),
        exists: z.boolean(),
        filesystem: z.string().nullable(),
        isSubvolume: z.boolean(),
        reflinkSupported: z.boolean(),
        reflinkMessage: z.string().nullable(),
        subvolumeDeleteAllowed: z.boolean().nullable(),
        mode: copyModeSchema.nullable(),
      })
      .strict(),
  },
  /** Replace a plain checkout directory with a subvolume of the same contents. */
  convert: {
    input: z
      .object({ path: z.string().min(1), timeoutMs: z.number().int().positive() })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("converted"), path: z.string().min(1) }).strict(),
      failed,
    ]),
  },
  remove: {
    input: z
      .object({
        operationId: z.string().min(1),
        pathKey: z.string().min(1),
        path: z.string().min(1).nullable(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("removed") }).strict(),
      failed,
    ]),
  },
});

export const cowProgressSchema = z
  .object({
    operationId: z.string().min(1),
    kind: z.enum(["step", "log"]),
    text: z.string().min(1),
  })
  .strict();
export type CowProgress = z.infer<typeof cowProgressSchema>;

export const cowHostSignals = {
  progress: { payload: cowProgressSchema },
} as const;
