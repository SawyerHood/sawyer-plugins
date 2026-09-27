// Shared vocabulary for the server entry and the OpenRouter HTTP helpers. BB
// 0.44 runs the AI-service functions in the plugin's server process, so the key
// and the chosen models stay here: nothing is pushed to a host daemon.
import { z } from "zod";

export const SERVICE_ID = "openrouter-inference";
export const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
export const DEFAULT_TRANSCRIPTION_MODEL = "openai/gpt-4o-mini-transcribe";

/** The plugin's two configurable jobs: `inference` covers titles and commit messages, `voice` transcribes audio. */
export const serviceKindSchema = z.enum(["inference", "voice"]);
export type ServiceKind = z.infer<typeof serviceKindSchema>;

/** The BB tasks each kind serves, as `bb.sdk.system.setAiServiceSelection` names them. */
export const TASKS: Record<ServiceKind, readonly ("thread-title" | "commit-message" | "voice")[]> = {
  inference: ["thread-title", "commit-message"],
  voice: ["voice"],
};

export const reasoningParamSchema = z
  .object({
    effort: z.string().optional(),
    enabled: z.boolean().optional(),
    exclude: z.boolean().optional(),
  })
  .strict()
  .nullable();
export type ReasoningParam = z.infer<typeof reasoningParamSchema>;

export const serviceConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    model: z.string().min(1),
    reasoning: reasoningParamSchema,
    transcriptionModel: z.string().min(1),
  })
  .strict();
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;
