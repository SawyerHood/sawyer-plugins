import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  BRAIN_INTRO_PROMPT,
  DEFAULT_BRAIN_SELECTION,
  MikuBrainCoordinator,
  type AppActivity,
} from "./brain";
import {
  brainRpcContract,
  brainSelectionSchema,
  type BrainSelection,
} from "./brain-contract";
import type { MikuEvent, MikuEventType } from "./companion";
import { watchTaskCompletions } from "./task-events";
import { renderTestBenchHtml } from "./test-bench";

const BRAIN_STATE_KEY = "brain-state-v1";

interface StoredBrainState {
  threadId: string | null;
  selection: BrainSelection;
}

function resolveAssetPath(moduleUrl: string): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  const adjacent = join(moduleDirectory, "assets", "miku.png");
  if (existsSync(adjacent)) return adjacent;
  const parent = join(moduleDirectory, "..", "assets", "miku.png");
  if (existsSync(parent)) return parent;
  throw new Error(`Miku's sprite sheet is missing beside ${moduleDirectory}`);
}

function parseStoredBrainState(value: unknown): StoredBrainState {
  if (typeof value !== "object" || value === null) {
    return { threadId: null, selection: DEFAULT_BRAIN_SELECTION };
  }
  const candidate = value as { threadId?: unknown; selection?: unknown };
  const selection = brainSelectionSchema.safeParse(candidate.selection);
  return {
    threadId: typeof candidate.threadId === "string" ? candidate.threadId : null,
    selection: selection.success ? selection.data : DEFAULT_BRAIN_SELECTION,
  };
}

function displayTitle(thread: { title: string | null; titleFallback?: string | null }): string {
  return thread.title ?? thread.titleFallback ?? "Untitled thread";
}

function clipText(value: string | null | undefined, limit = 1_200): string {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length === 0) return "No details were provided.";
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

const MIKU_ASSET_PATH = resolveAssetPath(import.meta.url);

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    brainEnabled: {
      type: "boolean",
      label: "Agent-powered comments",
      description:
        "Let a hidden BB thread turn batches of app activity into Miku's speech.",
      default: false,
    },
    brainProject: {
      type: "project",
      label: "Brain project",
      description: "The project that owns Miku's hidden brain thread.",
    },
    autonomousMinutes: {
      type: "number",
      label: "Autonomous check-in interval (minutes)",
      description: "Use 0 to disable periodic comments.",
      experimental_schema: z.number().int().min(0).max(120),
      default: 15,
    },
  });
  let settingValues = await settings.get();
  let brainState = parseStoredBrainState(
    await bb.storage.kv.get<unknown>(BRAIN_STATE_KEY),
  );

  const saveBrainState = async (): Promise<void> => {
    await bb.storage.kv.set(BRAIN_STATE_KEY, brainState);
  };

  const publish = (
    type: MikuEventType,
    details: Omit<MikuEvent, "id" | "type" | "at"> = {},
  ): void => {
    bb.realtime.publish("companion-events", {
      id: crypto.randomUUID(),
      type,
      at: Date.now(),
      ...details,
    } satisfies MikuEvent);
  };

  const brain = new MikuBrainCoordinator(
    bb,
    () => ({
      enabled: settingValues.brainEnabled,
      threadId: brainState.threadId,
      autonomousMinutes: settingValues.autonomousMinutes,
      ...brainState.selection,
    }),
    (type, details) => publish(type, details),
  );

  const useBrainOr = (
    activity: AppActivity,
    fallbackType: MikuEventType,
    fallbackDetails: Omit<MikuEvent, "id" | "type" | "at"> = {},
  ): void => {
    if (!brain.enqueue(activity)) publish(fallbackType, fallbackDetails);
  };

  const isBrainWorker = (thread: {
    id: string;
    originPluginId?: string | null;
    visibility?: string;
  }): boolean =>
    thread.id === brainState.threadId ||
    (thread.originPluginId === bb.pluginId && thread.visibility === "hidden");

  settings.onChange((next, previous) => {
    settingValues = next;
    if (next.brainProject !== previous.brainProject) {
      brainState = { ...brainState, threadId: null };
      void saveBrainState().catch((error) =>
        bb.log.warn(`Could not clear Miku's old brain selection: ${String(error)}`),
      );
      publish("brain-dismiss");
    }
  });

  bb.rpc.register(brainRpcContract, {
    async "brain.get"({ projectId }) {
      const threads =
        projectId === null
          ? []
          : await bb.sdk.threads.list({
              projectId,
              includeHidden: true,
              originPluginId: bb.pluginId,
              limit: 100,
            });
      return {
        threadId: brainState.threadId,
        selection: brainState.selection,
        threads: threads
          .filter((thread) => thread.visibility === "hidden")
          .map((thread) => ({
            id: thread.id,
            projectId: thread.projectId,
            providerId: thread.providerId,
            title: displayTitle(thread),
            status: thread.status,
          })),
      };
    },
    async "brain.configure"(selection) {
      const providerChanged = selection.providerId !== brainState.selection.providerId;
      brainState = {
        threadId: providerChanged ? null : brainState.threadId,
        selection,
      };
      await saveBrainState();
      if (providerChanged) publish("brain-dismiss");
      return brainState.selection;
    },
    async "brain.select"({ threadId }) {
      if (threadId !== null) {
        const thread = await bb.sdk.threads.get({ threadId });
        if (
          thread.originPluginId !== bb.pluginId ||
          thread.visibility !== "hidden" ||
          (settingValues.brainProject !== undefined &&
            thread.projectId !== settingValues.brainProject)
        ) {
          throw new Error("That thread is not a Miku brain in the selected project");
        }
        brainState = {
          threadId,
          selection: { ...brainState.selection, providerId: thread.providerId },
        };
      } else {
        brainState = { ...brainState, threadId: null };
      }
      await saveBrainState();
      publish("brain-dismiss");
      return { threadId: brainState.threadId };
    },
    async "brain.create"({ projectId, selection }) {
      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        prompt: BRAIN_INTRO_PROMPT,
        title: "Miku's hidden brain",
        visibility: "hidden",
        permissionMode: selection.permissionMode,
        providerId: selection.providerId,
        model: selection.model,
        reasoningLevel: selection.reasoningLevel,
        ...(selection.serviceTier === null
          ? {}
          : { serviceTier: selection.serviceTier }),
      });
      try {
        await bb.sdk.threads.wait({
          threadId: thread.id,
          status: "idle",
          timeoutMs: 120_000,
        });
      } finally {
        await bb.sdk.threads.stop({ threadId: thread.id }).catch(() => undefined);
      }
      brainState = { threadId: thread.id, selection };
      await saveBrainState();
      return {
        thread: {
          id: thread.id,
          projectId: thread.projectId,
          providerId: thread.providerId,
          title: displayTitle(thread),
          status: "idle",
        },
      };
    },
  });

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

  bb.experimental_hooks.on("message.dispatch", (context) => {
    if (!isBrainWorker(context.thread)) {
      useBrainOr(
        {
          kind: "message sent",
          threadId: context.thread.id,
          projectId: context.thread.projectId,
          summary: `In “${displayTitle(context.thread)}”, the user said: ${clipText(context.input.text, 700)}`,
        },
        "message-dispatched",
        { threadId: context.thread.id, projectId: context.thread.projectId },
      );
    }
    return { action: "proceed" };
  });

  bb.events.on("thread.created", ({ thread }) => {
    if (isBrainWorker(thread)) return;
    useBrainOr(
      {
        kind: "thread created",
        threadId: thread.id,
        projectId: thread.projectId,
        summary: `A new thread named “${displayTitle(thread)}” was created.`,
      },
      "thread-created",
      { threadId: thread.id, projectId: thread.projectId },
    );
  });
  bb.events.on("thread.active", ({ thread }) => {
    if (isBrainWorker(thread)) return;
    useBrainOr(
      {
        kind: "work started",
        threadId: thread.id,
        projectId: thread.projectId,
        summary: `The agent started working in “${displayTitle(thread)}”.`,
      },
      "thread-active",
      { threadId: thread.id, projectId: thread.projectId },
    );
  });
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    if (isBrainWorker(thread)) return;
    useBrainOr(
      {
        kind: "work completed",
        threadId: thread.id,
        projectId: thread.projectId,
        summary: `“${displayTitle(thread)}” became idle. Its latest result: ${clipText(lastAssistantText)}`,
      },
      "thread-idle",
      { threadId: thread.id, projectId: thread.projectId },
    );
  });
  bb.events.on("thread.failed", ({ thread, error }) => {
    if (isBrainWorker(thread)) return;
    useBrainOr(
      {
        kind: "work failed",
        threadId: thread.id,
        projectId: thread.projectId,
        summary: `“${displayTitle(thread)}” failed: ${clipText(error, 700)}`,
      },
      "thread-failed",
      { threadId: thread.id, projectId: thread.projectId },
    );
  });
  bb.events.on("turn.failed", ({ threadId, errorInfo }) => {
    if (threadId === brainState.threadId) return;
    useBrainOr(
      {
        kind: "turn failed",
        threadId,
        summary: `A provider turn failed${errorInfo?.category ? ` (${errorInfo.category})` : ""}.`,
      },
      "thread-failed",
      { threadId },
    );
  });
  bb.events.on("thread.archived", ({ thread }) => {
    if (isBrainWorker(thread)) return;
    useBrainOr(
      {
        kind: "thread archived",
        threadId: thread.id,
        projectId: thread.projectId,
        summary: `“${displayTitle(thread)}” was archived.`,
      },
      "thread-archived",
      { threadId: thread.id, projectId: thread.projectId },
    );
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    if (isBrainWorker(thread)) return;
    useBrainOr(
      {
        kind: "thread deleted",
        threadId: thread.id,
        projectId: thread.projectId,
        summary: `“${displayTitle(thread)}” was deleted.`,
      },
      "thread-archived",
      { threadId: thread.id, projectId: thread.projectId },
    );
  });
  bb.events.on("interaction.pending", ({ thread }) => {
    if (isBrainWorker(thread)) return;
    useBrainOr(
      {
        kind: "input requested",
        threadId: thread.id,
        projectId: thread.projectId,
        summary: `“${displayTitle(thread)}” needs the user's input.`,
      },
      "interaction-pending",
      { threadId: thread.id, projectId: thread.projectId },
    );
  });
  bb.events.on("message.queued", ({ entry }) => {
    if (entry.threadId === brainState.threadId) return;
    useBrainOr(
      {
        kind: "message queued",
        threadId: entry.threadId,
        summary: "A message is waiting for its thread to become available.",
      },
      "message-queued",
      { threadId: entry.threadId },
    );
  });
  bb.events.on("message.dispatched", ({ entry }) => {
    if (entry.threadId === brainState.threadId) return;
    useBrainOr(
      {
        kind: "queued message dispatched",
        threadId: entry.threadId,
        summary: "A previously queued message started running.",
      },
      "message-dispatched",
      { threadId: entry.threadId },
    );
  });

  bb.background.service("brain", {
    start: (signal) => brain.run(signal),
  });
  bb.background.service("task-events", {
    async start(signal) {
      await watchTaskCompletions(bb.server.loopbackBaseUrl, signal, (event) => {
        useBrainOr(
          {
            kind: "task completed",
            projectId: event.projectId,
            summary: `${event.taskKey} was marked complete.`,
          },
          "task-completed",
          event,
        );
      });
    },
  });

  bb.log.info("Miku is ready to roam, observe, and react");
}
