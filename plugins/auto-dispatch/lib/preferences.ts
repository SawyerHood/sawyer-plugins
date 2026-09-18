// Everything the user sets that is not a key. BB draws declared settings as one
// flat card above the plugin's own sections, with no way to group them or to
// leave one out, so only the keys and the choice between them are declared.
// The rest lives here, in the plugin's own storage, where the settings page can
// put each next to what it governs. `bb auto-dispatch preferences` reads and
// writes them from a shell. Shared by the server and the app.
import { z } from "zod";

/** Kept here, not with the Jev client, so the app can share this file without the client's Node code. */
export const DEFAULT_JEV_MODELS = {
  vercel: "typesafe-ai/jev",
  openrouter: "typesafe/jev-1.13",
} as const;

export const PERMISSION_MODES = ["accept-edits", "auto", "full"] as const;

export const INSTRUCTIONS_MAX = 4_000;
const instructionsSchema = z.string().max(INSTRUCTIONS_MAX);
const jevModelSchema = z.string().trim().min(1).max(200);

export const preferencesSchema = z
  .object({
    generalInstructions: instructionsSchema.default(""),
    modelInstructions: instructionsSchema.default(""),
    projectInstructions: instructionsSchema.default(""),
    machineInstructions: instructionsSchema.default(""),
    environmentInstructions: instructionsSchema.default(""),
    /** For threads `bb auto-dispatch spawn` starts. In the composer the picker is the user's. */
    permissionMode: z.enum(PERMISSION_MODES).default("auto"),
    jevModel: jevModelSchema.default(DEFAULT_JEV_MODELS.vercel),
    openRouterJevModel: jevModelSchema.default(DEFAULT_JEV_MODELS.openrouter),
    /** Which of the composer's pickers Auto may set. Effort is chosen per model, so it needs `model`. */
    autoSets: z
      .object({
        project: z.boolean().default(true),
        placement: z.boolean().default(true),
        model: z.boolean().default(true),
        effort: z.boolean().default(true),
      })
      .strict()
      .default({ project: true, placement: true, model: true, effort: true }),
    /** Hold the composer's send until the pickers match the draft. */
    holdSend: z.boolean().default(true),
    /** Ask Jev as the draft is typed, or only once typing pauses. */
    pace: z.enum(["typing", "pause"]).default("typing"),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export type AutoSets = Preferences["autoSets"];
export type Pace = Preferences["pace"];

export const preferencesPatchSchema = preferencesSchema.partial().strict();
export const DEFAULT_PREFERENCES: Preferences = preferencesSchema.parse({});
