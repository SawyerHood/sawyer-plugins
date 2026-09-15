import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import { MinusSignIcon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import {
  definePluginApp,
  experimental_NewThreadComposer as NewThreadComposer,
  ThreadChat,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { ChatSummary, quickChatRpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  formatRelativeTime,
  quickChat,
  useQuickChatState,
} from "@/lib/quick-chat-store";
import { cn } from "@/lib/utils";
import { useDraggableWindow } from "@/lib/window-position";

const CHATS_CHANGED = "chats-changed";
const COLLAPSED_RECENT_COUNT = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs `refetch` on mount, on chat changes, and after a reconnect. */
function useChatSignal(refetch: () => void) {
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime(CHATS_CHANGED, refetch);
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  useEffect(() => {
    if (previousConnection.current !== "connected" && connection === "connected") {
      refetch();
    }
    previousConnection.current = connection;
  }, [connection, refetch]);
}

function HeaderIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-foreground"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function RecentChats({ onSelect }: { onSelect: (threadId: string) => void }) {
  const rpc = useRpc<typeof quickChatRpcContract>();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const refetch = useCallback(() => {
    rpc.call("listChats", null).then(
      (result) => setChats(result.chats),
      (error: unknown) => toast.error(`Quick chat: ${errorMessage(error)}`),
    );
  }, [rpc]);
  useChatSignal(refetch);

  if (chats === null || chats.length === 0) return null;
  const now = Date.now();
  const visible = expanded ? chats : chats.slice(0, COLLAPSED_RECENT_COUNT);
  return (
    <div className="flex flex-col gap-0.5 pb-2">
      <div className="px-2 pb-1 text-sm text-muted-foreground">Recent chats</div>
      {visible.map((chat) => (
        <button
          key={chat.id}
          type="button"
          className="flex items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-state-hover"
          onClick={() => onSelect(chat.id)}
        >
          <span className="min-w-0 flex-1 truncate">{chat.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelativeTime(chat.updatedAt, now)}
          </span>
        </button>
      ))}
      {chats.length > COLLAPSED_RECENT_COUNT ? (
        <button
          type="button"
          className="rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "See all"}
        </button>
      ) : null}
    </div>
  );
}

function NewChatView({ focusRequest }: { focusRequest: number }) {
  const rpc = useRpc<typeof quickChatRpcContract>();
  const [personalProjectId, setPersonalProjectId] = useState<
    string | null | undefined
  >(undefined);
  useEffect(() => {
    let cancelled = false;
    rpc.call("personalProject", null).then(
      (result) => {
        if (!cancelled) setPersonalProjectId(result.projectId);
      },
      () => {
        if (!cancelled) setPersonalProjectId(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto px-2">
        <RecentChats onSelect={quickChat.showChat} />
      </div>
      {personalProjectId === undefined ? null : (
        <div className="quick-chat-composer shrink-0 px-2 pb-2">
          <NewThreadComposer
            {...(personalProjectId === null
              ? {}
              : { defaultProjectId: personalProjectId })}
            layout="document"
            placeholder="Ask anything"
            draftKey="quick-chat"
            focusRequest={focusRequest}
            onSubmit={async (request) => {
              try {
                const { threadId } = await rpc.call("createChat", { request });
                quickChat.showChat(threadId);
              } catch (error) {
                toast.error(`Could not start quick chat: ${errorMessage(error)}`);
                throw error;
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function ChatView({
  threadId,
  focusRequest,
}: {
  threadId: string;
  focusRequest: number;
}) {
  // ThreadChat only focuses when focusRequest changes after its composer
  // mounts, and it keeps the composer hidden while pending interactions load,
  // so a request made on open is spent before the editor can take focus.
  // Bump the request once the editor is visible.
  const containerRef = useRef<HTMLDivElement>(null);
  const [composerShown, setComposerShown] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const editorVisible = () =>
      container
        .querySelector<HTMLElement>('[contenteditable="true"]')
        ?.checkVisibility() === true;
    if (editorVisible()) {
      setComposerShown(1);
      return;
    }
    const observer = new MutationObserver(() => {
      if (!editorVisible()) return;
      observer.disconnect();
      setComposerShown(1);
    });
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "style"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full min-h-0">
      <ThreadChat
        threadId={threadId}
        variant="compact"
        layout="contained"
        permissionPolicy="editable"
        focusRequest={focusRequest + composerShown}
        className="h-full min-h-0"
      />
    </div>
  );
}

function useChatTitle(threadId: string | null): string | null {
  const rpc = useRpc<typeof quickChatRpcContract>();
  const [title, setTitle] = useState<string | null>(null);
  const refetch = useCallback(() => {
    if (threadId === null) {
      setTitle(null);
      return;
    }
    rpc.call("getChat", { threadId }).then(
      (result) => {
        if (result.chat === null) quickChat.newChat();
        else setTitle(result.chat.title);
      },
      () => undefined,
    );
  }, [rpc, threadId]);
  useChatSignal(refetch);
  return title;
}

function QuickChatWindow({
  threadId,
  focusRequest,
}: {
  threadId: string | null;
  focusRequest: number;
}) {
  const rpc = useRpc<typeof quickChatRpcContract>();
  const navigate = useBbNavigate();
  const title = useChatTitle(threadId);
  const windowRef = useRef<HTMLElement>(null);
  const drag = useDraggableWindow(windowRef);

  const openAsThread = async () => {
    if (threadId === null) return;
    try {
      await rpc.call("openAsThread", { threadId });
      quickChat.newChat();
      quickChat.close();
      navigate.toThread(threadId);
    } catch (error) {
      toast.error(`Could not open chat: ${errorMessage(error)}`);
    }
  };

  return (
    <section
      ref={windowRef}
      role="dialog"
      aria-label="Quick chat"
      style={drag.style}
      className={cn(
        "fixed bottom-4 right-4 z-40 flex flex-col overflow-hidden",
        "h-[min(680px,calc(100dvh-5rem))] w-[min(560px,calc(100vw-2rem))]",
        "max-sm:inset-x-2 max-sm:bottom-2 max-sm:top-14 max-sm:h-auto max-sm:w-auto",
        "rounded-2xl border border-border bg-background text-foreground shadow-2xl",
      )}
    >
      <header
        {...drag.handleProps}
        className={cn(
          "flex h-11 shrink-0 touch-none select-none items-center gap-1 border-b border-border/60 px-2",
          drag.draggable && (drag.dragging ? "cursor-grabbing" : "cursor-grab"),
        )}
      >
        {threadId !== null ? (
          <HeaderIconButton label="New chat" onClick={quickChat.newChat}>
            <HugeiconsIcon icon={PencilEdit02Icon} className="size-4" />
          </HeaderIconButton>
        ) : null}
        <span className="min-w-0 flex-1 truncate px-1 text-sm text-muted-foreground">
          {threadId === null ? "New chat" : (title ?? "Chat")}
        </span>
        {threadId !== null ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
            onClick={() => void openAsThread()}
          >
            <Icon name="ArrowUpRight" className="size-4" />
            Open as thread
          </Button>
        ) : null}
        <HeaderIconButton label="Minimize quick chat" onClick={quickChat.close}>
          <HugeiconsIcon icon={MinusSignIcon} className="size-4" />
        </HeaderIconButton>
      </header>
      <div className="min-h-0 flex-1">
        {threadId === null ? (
          <NewChatView focusRequest={focusRequest} />
        ) : (
          <ChatView
            key={threadId}
            threadId={threadId}
            focusRequest={focusRequest}
          />
        )}
      </div>
    </section>
  );
}

function QuickChatOverlay() {
  const { open, threadId, focusRequest } = useQuickChatState();

  if (!open) return null;
  // ThreadChat's controls use tooltips, and the app overlay slot mounts
  // outside the host's TooltipProvider. The radix import is shimmed to the
  // host's copy, so this provider feeds the host components.
  return (
    <TooltipProvider delayDuration={300}>
      <QuickChatWindow threadId={threadId} focusRequest={focusRequest} />
    </TooltipProvider>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "quick-chat",
    component: QuickChatOverlay,
  });
  app.commands.register({
    id: "toggle",
    title: "Quick chat: toggle",
    defaultShortcut: { key: "k", mod: true, shift: true },
    run: () => quickChat.toggle(),
  });
  app.commands.register({
    id: "open",
    title: "Quick chat: open",
    run: () => quickChat.open(),
  });
  app.commands.register({
    id: "new-chat",
    title: "Quick chat: new chat",
    run: () => quickChat.newChat(),
  });
  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "quick-chat",
    label: "Quick chat",
    icon: "MessageSquare",
    onActivate: () => quickChat.toggle(),
  });
});
