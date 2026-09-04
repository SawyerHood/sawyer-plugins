import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const reasoningLevelSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
]);

export const brainSelectionSchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1),
    reasoningLevel: reasoningLevelSchema,
    serviceTier: z.enum(["default", "fast"]).nullable(),
    permissionMode: z.enum(["accept-edits", "auto", "full"]).default("auto"),
  })
  .strict();

const brainThreadSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    providerId: z.string(),
    title: z.string(),
    status: z.string(),
  })
  .strict();

export const brainRpcContract = defineRpcContract({
  "brain.get": {
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z
      .object({
        threadId: z.string().nullable(),
        selection: brainSelectionSchema,
        threads: z.array(brainThreadSchema),
      })
      .strict(),
  },
  "brain.configure": {
    input: brainSelectionSchema,
    output: brainSelectionSchema,
  },
  "brain.select": {
    input: z.object({ threadId: z.string().nullable() }).strict(),
    output: z.object({ threadId: z.string().nullable() }).strict(),
  },
  "brain.create": {
    input: z
      .object({
        projectId: z.string(),
        selection: brainSelectionSchema,
      })
      .strict(),
    output: z.object({ thread: brainThreadSchema }).strict(),
  },
});

export type BrainSelection = z.infer<typeof brainSelectionSchema>;
