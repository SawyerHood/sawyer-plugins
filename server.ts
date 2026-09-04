import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { MikuEvent, MikuEventType } from "./companion";
import { watchTaskCompletions } from "./task-events";
import { renderTestBenchHtml } from "./test-bench";

function resolveAssetPath(moduleUrl: string): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  const adjacent = join(moduleDirectory, "assets", "miku.png");
  if (existsSync(adjacent)) return adjacent;

  // Built server bundles live in dist/, while package assets remain at root.
  const parent = join(moduleDirectory, "..", "assets", "miku.png");
  if (existsSync(parent)) return parent;
  throw new Error(`Miku's sprite sheet is missing beside ${moduleDirectory}`);
}

const MIKU_ASSET_PATH = resolveAssetPath(import.meta.url);

export default function plugin(bb: BbPluginApi) {
  const publish = (
    type: MikuEventType,
    details: Omit<MikuEvent, "id" | "type" | "at"> = {},
  ): void => {
    const event: MikuEvent = {
      id: crypto.randomUUID(),
      type,
      at: Date.now(),
      ...details,
    };
    bb.realtime.publish("companion-events", event);
  };

  bb.http.route("GET", "/assets/miku.png", async () => {
    const bytes = await readFile(MIKU_ASSET_PATH);
    return new Response(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      {
        headers: {
          "cache-control": "private, max-age=3600",
          "content-type": "image/png",
        },
      },
    );
  });
  bb.http.route("GET", "/test-bench", () =>
    new Response(renderTestBenchHtml(), {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      },
    }),
  );

  bb.events.on("thread.created", ({ thread }) => {
    publish("thread-created", { threadId: thread.id, projectId: thread.projectId });
  });
  bb.events.on("thread.active", ({ thread }) => {
    publish("thread-active", { threadId: thread.id, projectId: thread.projectId });
  });
  bb.events.on("thread.idle", ({ thread }) => {
    publish("thread-idle", { threadId: thread.id, projectId: thread.projectId });
  });
  bb.events.on("thread.failed", ({ thread }) => {
    publish("thread-failed", { threadId: thread.id, projectId: thread.projectId });
  });
  bb.events.on("turn.failed", ({ threadId }) => {
    publish("thread-failed", { threadId });
  });
  bb.events.on("thread.archived", ({ thread }) => {
    publish("thread-archived", { threadId: thread.id, projectId: thread.projectId });
  });
  bb.events.on("interaction.pending", ({ thread }) => {
    publish("interaction-pending", {
      threadId: thread.id,
      projectId: thread.projectId,
    });
  });
  bb.events.on("message.queued", ({ entry }) => {
    publish("message-queued", { threadId: entry.threadId });
  });
  bb.events.on("message.dispatched", ({ entry }) => {
    publish("message-dispatched", { threadId: entry.threadId });
  });

  bb.background.service("task-events", {
    async start(signal) {
      await watchTaskCompletions(bb.server.loopbackBaseUrl, signal, (event) => {
        publish("task-completed", event);
      });
    },
  });

  bb.log.info("Miku is ready to roam and react");
}
