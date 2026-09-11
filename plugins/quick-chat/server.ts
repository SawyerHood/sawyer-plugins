import {
  defineRpcContract,
  type BbPluginApi,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

export const RECENT_CHAT_LIMIT = 50;

/** Realtime channel the overlay refetches its chat list on. */
export const CHATS_CHANGED = "chats-changed";

const chatSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number(),
});
export type ChatSummary = z.infer<typeof chatSummarySchema>;

// The composer's NewThreadRequest, checked for its load-bearing fields and
// otherwise forwarded unchanged; `threads.spawn` validates the full shape.
const newThreadRequestShape = z.object({
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  input: z.array(z.unknown()).min(1),
  environment: z.object({ type: z.string() }),
});
const newThreadRequestSchema = z.custom<NewThreadRequest>(
  (value) => newThreadRequestShape.safeParse(value).success,
  "Expected a new thread request from the composer",
);

const threadIdSchema = z.string().trim().min(1);

export const quickChatRpcContract = defineRpcContract({
  personalProject: {
    input: z.null(),
    output: z.object({ projectId: z.string().nullable() }),
  },
  createChat: {
    input: z.object({ request: newThreadRequestSchema }).strict(),
    output: z.object({ threadId: z.string() }).strict(),
  },
  listChats: {
    input: z.null(),
    output: z.object({ chats: z.array(chatSummarySchema) }),
  },
  getChat: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({ chat: chatSummarySchema.nullable() }),
  },
  openAsThread: {
    input: z.object({ threadId: threadIdSchema }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});

interface ThreadLike {
  id: string;
  title: string | null;
  titleFallback: string | null;
  updatedAt: number;
  originPluginId: string | null;
  archivedAt: number | null;
  deletedAt: number | null;
}

export function toChatSummary(thread: ThreadLike): ChatSummary {
  return {
    id: thread.id,
    title: thread.title ?? thread.titleFallback ?? "New chat",
    updatedAt: thread.updatedAt,
  };
}

export default async function plugin(bb: BbPluginApi) {
  // Ids of this plugin's chats, so thread change events for unrelated threads
  // never trigger a refetch.
  const knownChatIds = new Set<string>();

  async function listChats(): Promise<ChatSummary[]> {
    const threads = await bb.sdk.threads.list({
      originPluginId: bb.pluginId,
      includeHidden: true,
      archived: false,
      limit: RECENT_CHAT_LIMIT,
    });
    // A chat opened as a full thread becomes visible and leaves quick chat.
    const chats = threads.filter((thread) => thread.visibility === "hidden");
    for (const thread of chats) knownChatIds.add(thread.id);
    return chats
      .map(toChatSummary)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async function getOwnChat(threadId: string): Promise<ThreadLike | null> {
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      if (
        thread.originPluginId !== bb.pluginId ||
        thread.archivedAt !== null ||
        thread.deletedAt !== null
      ) {
        return null;
      }
      return thread;
    } catch {
      return null;
    }
  }

  bb.rpc.register(quickChatRpcContract, {
    async personalProject() {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      const personal = projects.find((project) => project.kind === "personal");
      return { projectId: personal?.id ?? null };
    },
    async createChat({ request }) {
      const thread = await bb.sdk.threads.spawn({
        ...request,
        visibility: "hidden",
      });
      knownChatIds.add(thread.id);
      bb.realtime.publish(CHATS_CHANGED, null);
      return { threadId: thread.id };
    },
    listChats: async () => ({ chats: await listChats() }),
    async getChat({ threadId }) {
      const thread = await getOwnChat(threadId);
      return { chat: thread === null ? null : toChatSummary(thread) };
    },
    async openAsThread({ threadId }) {
      if ((await getOwnChat(threadId)) === null) {
        throw new Error("That quick chat no longer exists.");
      }
      await bb.sdk.threads.update({ threadId, visibility: "visible" });
      knownChatIds.delete(threadId);
      bb.realtime.publish(CHATS_CHANGED, null);
      return { ok: true as const };
    },
  });

  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    callback(event) {
      if (event.id === undefined || !knownChatIds.has(event.id)) return;
      const relevant = event.changes.some(
        (change) =>
          change === "title-changed" ||
          change === "status-changed" ||
          change === "archived-changed" ||
          change === "thread-deleted",
      );
      if (!relevant || publishTimer !== null) return;
      publishTimer = setTimeout(() => {
        publishTimer = null;
        bb.realtime.publish(CHATS_CHANGED, null);
      }, 300);
    },
  });

  bb.onDispose(() => {
    unsubscribe();
    if (publishTimer !== null) clearTimeout(publishTimer);
  });
}
