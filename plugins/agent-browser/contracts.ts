import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const idSchema = z.string().min(1).max(160);
export const sessionIdSchema = z.string().uuid();
export const inputModeSchema = z.enum(["instant", "smooth", "human"]);
export type InputMode = z.infer<typeof inputModeSchema>;
export const sessionSchema = z
  .object({
    id: sessionIdSchema,
    threadId: idSchema,
    hostId: idSchema,
    backend: z.enum(["desktop", "local"]),
    state: z.enum(["ready", "stopped", "closed"]),
    inputMode: inputModeSchema,
    cursor: z.boolean(),
    cursorDetail: z.string().max(400).nullable(),
    createdAt: z.number().int(),
    expiresAt: z.number().int(),
  })
  .strict();
export type Session = z.infer<typeof sessionSchema>;
export const selectionSchema = z.discriminatedUnion("backend", [
  z.object({ backend: z.literal("local"), hostId: idSchema }).strict(),
  z
    .object({
      backend: z.literal("desktop"),
      hostId: idSchema,
      instanceId: idSchema,
      tabId: idSchema.optional(),
    })
    .strict(),
]);
export const openSchema = z
  .object({
    threadId: idSchema,
    selection: selectionSchema,
    inputMode: inputModeSchema.default("instant"),
    cursor: z.boolean().default(false),
    ignoreHttpsErrors: z.boolean().default(false),
  })
  .strict();
export const ownedSchema = z
  .object({ threadId: idSchema, sessionId: sessionIdSchema })
  .strict();
export const argsSchema = z
  .array(z.string().max(64_000))
  .min(1)
  .max(128)
  .refine(
    (args) => args.reduce((total, arg) => total + arg.length, 0) <= 128_000,
    "agent-browser arguments exceed 128,000 characters",
  );
export const runSchema = ownedSchema.extend({
  args: argsSchema,
  timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
});
export const screenshotSchema = ownedSchema.extend({
  full: z.boolean().default(false),
  annotate: z.boolean().default(false),
});
export const imageSchema = z
  .object({
    path: z.string().min(1),
    mimeType: z.literal("image/jpeg"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export const outputSchema = z
  .object({
    text: z.string().max(160_000),
    images: z.array(imageSchema).max(4),
    exitCode: z.number().int(),
  })
  .strict();
export type RunOutput = z.infer<typeof outputSchema>;
export const recordingSchema = z
  .object({
    path: z.string().min(1),
    mimeType: z.literal("video/webm"),
    bytes: z.number().int().nonnegative(),
  })
  .strict();
export type Recording = z.infer<typeof recordingSchema>;
/** `recording` is null, with the reason in `detail`, when no take exists. */
export const recordingOutputSchema = z
  .object({
    recording: recordingSchema.nullable(),
    detail: z.string().max(400).nullable(),
  })
  .strict();
export type RecordingOutput = z.infer<typeof recordingOutputSchema>;
export const previewFrameSchema = z
  .object({
    sequence: z.number().int().positive(),
    mimeType: z.literal("image/jpeg"),
    data: z.string().min(1).max(700_000),
    width: z.number().positive(),
    height: z.number().positive(),
    url: z.string().max(2_000),
    title: z.string().max(300),
  })
  .strict();
export type PreviewFrame = z.infer<typeof previewFrameSchema>;
export const previewSizeSchema = z.enum(["thumbnail", "full"]);
export type PreviewSize = z.infer<typeof previewSizeSchema>;
export const previewSchema = ownedSchema.extend({
  afterSequence: z.number().int().nonnegative().default(0),
  size: previewSizeSchema.default("thumbnail"),
});
export const previewOutputSchema = z
  .object({ session: sessionSchema, frame: previewFrameSchema.nullable() })
  .strict();
export type PreviewOutput = z.infer<typeof previewOutputSchema>;
export const rpcContract = defineRpcContract({
  open: { input: openSchema, output: sessionSchema },
  list: {
    input: z.object({ threadId: idSchema }).strict(),
    output: z.array(sessionSchema).max(64),
  },
  run: { input: runSchema, output: outputSchema },
  screenshot: { input: screenshotSchema, output: outputSchema },
  recording: { input: ownedSchema, output: recordingOutputSchema },
  preview: { input: previewSchema, output: previewOutputSchema },
  stop: { input: ownedSchema, output: sessionSchema },
  close: { input: ownedSchema, output: sessionSchema },
});
export const runtimeStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), version: z.string() }).strict(),
  z.object({ status: z.literal("installing"), detail: z.string() }).strict(),
]);
export type RuntimeState = z.infer<typeof runtimeStateSchema>;
export const cursorStateSchema = z
  .object({ enabled: z.boolean(), detail: z.string().max(400).nullable() })
  .strict();
export type CursorState = z.infer<typeof cursorStateSchema>;
export const hostContract = defineRpcContract({
  prepare: {
    input: z.object({ chrome: z.boolean() }).strict(),
    output: runtimeStateSchema,
  },
  open: {
    input: z
      .object({
        sessionId: sessionIdSchema,
        connectionUrl: z.string().url().optional(),
        inputMode: inputModeSchema,
        cursor: z.boolean(),
        ignoreHttpsErrors: z.boolean(),
        expiresAt: z.number().int(),
        idleTimeoutMs: z.number().int().positive(),
      })
      .strict(),
    output: z.object({ cursor: cursorStateSchema }).strict(),
  },
  run: {
    input: z
      .object({
        sessionId: sessionIdSchema,
        args: argsSchema,
        timeoutMs: z.number().int().min(1000).max(300_000),
      })
      .strict(),
    output: z
      .object({ output: outputSchema, cursor: cursorStateSchema })
      .strict(),
  },
  screenshot: {
    input: z
      .object({
        sessionId: sessionIdSchema,
        full: z.boolean(),
        annotate: z.boolean(),
      })
      .strict(),
    output: outputSchema,
  },
  recording: {
    input: z.object({ sessionId: sessionIdSchema }).strict(),
    output: recordingOutputSchema,
  },
  preview: {
    input: z
      .object({
        sessionId: sessionIdSchema,
        afterSequence: z.number().int().nonnegative(),
        waitMs: z.number().int().min(0).max(10_000),
        size: previewSizeSchema,
      })
      .strict(),
    output: z.object({ frame: previewFrameSchema.nullable() }).strict(),
  },
  close: {
    input: z.object({ sessionId: sessionIdSchema }).strict(),
    output: z.null(),
  },
});
