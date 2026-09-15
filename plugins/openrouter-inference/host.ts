// Runs on the primary host daemon. BB routes BB_INFERENCE=openrouter-inference/…
// completions and BB_TRANSCRIPTION=openrouter-inference/… transcriptions here;
// the server keeps this host's config file current.
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_aiServicesHostContract } from "@get-bb/plugin-sdk/ai-services";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostConfigSchema, hostContract, SERVICE_ID, type HostConfig } from "./contract.js";
import { completeWithOpenRouter, failure, transcribeWithOpenRouter } from "./openrouter.js";
import { TEST_CLIP } from "./test-audio.js";

function configPath(dataDir: string): string {
  return join(dataDir, "openrouter.json");
}

async function readConfig(dataDir: string): Promise<HostConfig | null> {
  try {
    return hostConfigSchema.parse(JSON.parse(await readFile(configPath(dataDir), "utf8")));
  } catch {
    return null;
  }
}

const TEST_TIMEOUT_MS = 20_000;
const NOT_CONFIGURED =
  "OpenRouter is not configured on this host. Add an API key in the OpenRouter Inference plugin settings.";

export default experimental_defineHostEntry({
  contract: defineRpcContract({ ...experimental_aiServicesHostContract, ...hostContract }),
  handlers: {
    configure: async ({ config }, context) => {
      const path = configPath(context.experimental_paths.dataDir);
      if (config === null) {
        await rm(path, { force: true });
        return { configured: false };
      }
      await writeFile(path, JSON.stringify(config), { mode: 0o600 });
      return { configured: true };
    },
    test: async ({ kind }, context) => {
      const config = await readConfig(context.experimental_paths.dataDir);
      if (config === null) return failure("auth_required", "Add an OpenRouter API key first.");
      const startedAt = Date.now();
      if (kind === "voice") {
        const result = await transcribeWithOpenRouter(
          {
            serviceId: SERVICE_ID,
            model: "default",
            audioBase64: TEST_CLIP.base64,
            filename: TEST_CLIP.filename,
            mimeType: TEST_CLIP.mimeType,
            prompt: null,
            timeoutMs: TEST_TIMEOUT_MS,
          },
          config,
          context.signal,
        );
        if (!result.ok) return result;
        return { ok: true as const, text: result.text, model: result.model, durationMs: Date.now() - startedAt };
      }
      const result = await completeWithOpenRouter(
        {
          serviceId: SERVICE_ID,
          model: "default",
          reasoningEffort: "none",
          prompt:
            'Write a short title (at most 6 words) for a coding thread that starts with: "Add an OpenRouter plugin that generates thread titles and commit messages."',
          outputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
          timeoutMs: TEST_TIMEOUT_MS,
        },
        config,
        context.signal,
      );
      if (!result.ok) return result;
      const title = result.value.title;
      return {
        ok: true as const,
        text: typeof title === "string" ? title : JSON.stringify(result.value),
        model: result.model,
        durationMs: Date.now() - startedAt,
      };
    },
    "ai.inference.complete": async (input, context) => {
      if (input.serviceId !== SERVICE_ID) {
        return failure("request_failed", `This plugin serves no AI service "${input.serviceId}".`);
      }
      const config = await readConfig(context.experimental_paths.dataDir);
      if (config === null) return failure("auth_required", NOT_CONFIGURED);
      try {
        return await completeWithOpenRouter(input, config, context.signal);
      } catch (error) {
        return failure("request_failed", error instanceof Error ? error.message : String(error));
      }
    },
    "ai.voice.transcribe": async (input, context) => {
      if (input.serviceId !== SERVICE_ID) {
        return failure("request_failed", `This plugin serves no AI service "${input.serviceId}".`);
      }
      const config = await readConfig(context.experimental_paths.dataDir);
      if (config === null) return failure("auth_required", NOT_CONFIGURED);
      try {
        return await transcribeWithOpenRouter(input, config, context.signal);
      } catch (error) {
        return failure("request_failed", error instanceof Error ? error.message : String(error));
      }
    },
  },
});
