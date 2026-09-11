// Runs on the primary host daemon. BB routes BB_INFERENCE=openrouter-inference/…
// completions here; the server keeps this host's config file current.
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_aiServicesHostContract } from "@get-bb/plugin-sdk/ai-services";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostConfigSchema, hostContract, SERVICE_ID, type HostConfig } from "./contract.js";
import { completeWithOpenRouter, failure } from "./openrouter.js";

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
    test: async (_input, context) => {
      const config = await readConfig(context.experimental_paths.dataDir);
      if (config === null) return failure("auth_required", "Add an OpenRouter API key first.");
      const startedAt = Date.now();
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
        title: typeof title === "string" ? title : JSON.stringify(result.value),
        model: result.model,
        durationMs: Date.now() - startedAt,
      };
    },
    "ai.inference.complete": async (input, context) => {
      if (input.serviceId !== SERVICE_ID) {
        return failure("request_failed", `This plugin serves no AI service "${input.serviceId}".`);
      }
      const config = await readConfig(context.experimental_paths.dataDir);
      if (config === null) {
        return failure(
          "auth_required",
          "OpenRouter is not configured on this host. Add an API key in the OpenRouter Inference plugin settings.",
        );
      }
      try {
        return await completeWithOpenRouter(input, config, context.signal);
      } catch (error) {
        return failure("request_failed", error instanceof Error ? error.message : String(error));
      }
    },
    "ai.voice.transcribe": async () =>
      failure("request_failed", "OpenRouter Inference does not serve voice transcription."),
  },
});
