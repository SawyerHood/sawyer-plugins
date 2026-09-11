// The server's side of the host contract. host.ts adds BB's AI-services
// methods; the server runtime cannot import that SDK subpath, so this file
// must not either. `configure` is how the server hands the host the API key
// and chosen model (secret settings never leave the server otherwise).
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const SERVICE_ID = "openrouter-inference";
/** The value to put in BB_INFERENCE; the model segment follows the plugin setting. */
export const INFERENCE_SETTING_VALUE = `${SERVICE_ID}/default`;

export const reasoningParamSchema = z
  .object({
    effort: z.string().optional(),
    enabled: z.boolean().optional(),
    exclude: z.boolean().optional(),
  })
  .strict()
  .nullable();
export type ReasoningParam = z.infer<typeof reasoningParamSchema>;

export const hostConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    model: z.string().min(1),
    reasoning: reasoningParamSchema,
  })
  .strict();
export type HostConfig = z.infer<typeof hostConfigSchema>;

export const hostContract = defineRpcContract({
  configure: {
    input: z.object({ config: hostConfigSchema.nullable() }).strict(),
    output: z.object({ configured: z.boolean() }).strict(),
  },
  /** Generate a sample title with the host's current config. */
  test: {
    input: z.null(),
    output: z.union([
      z.object({ ok: z.literal(true), title: z.string(), model: z.string(), durationMs: z.number() }).strict(),
      z.object({ ok: z.literal(false), code: z.string(), message: z.string() }).strict(),
    ]),
  },
});
