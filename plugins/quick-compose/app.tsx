import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import {
  definePluginApp,
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useRpc,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import type { quickComposeRpcContract } from "./server";
import {
  quickCompose,
  useQuickComposeState,
  type QuickComposeKind,
  type QuickComposeSession,
} from "@/lib/quick-compose-store";
import { seedHandoffDraft, threadMentionToken } from "@/lib/handoff-draft";

// Pickers are cmdk popovers portaled out of the window; React still bubbles
// their events through the composer.
const PICKER_ROOT = "[cmdk-root]";
const PICKER_OPTION = "[cmdk-item]";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function closestMatch(target: EventTarget, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

function useSubmitThread(kind: QuickComposeKind) {
  const rpc = useRpc<typeof quickComposeRpcContract>();
  const navigate = useBbNavigate();
  return async (request: NewThreadRequest) => {
    try {
      const { threadId } = await rpc.call("createThread", { request });
      quickCompose.finish(kind);
      toast.success("Thread started", {
        action: {
          label: "Open",
          onClick: () => navigate.toThread(threadId),
        },
      });
    } catch (error) {
      toast.error(`Could not start thread: ${errorMessage(error)}`);
      throw error;
    }
  };
}

function QuickComposeWindow({
  kind,
  label,
  visible,
  children,
}: {
  kind: QuickComposeKind;
  label: string;
  visible: boolean;
  children: ReactNode;
}) {
  const windowRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const composeWindow = windowRef.current;
      if (event.key !== "Escape" || composeWindow === null) return;
      // Pickers render outside the window and handle their own Escape. The
      // editor handles Escape too: it closes a mention menu, or else blurs.
      const target = event.target instanceof Node ? event.target : null;
      const inWindow = target !== null && composeWindow.contains(target);
      const unhandled =
        !event.defaultPrevented && (inWindow || target === document.body);
      const blurredEditor =
        inWindow && !composeWindow.contains(document.activeElement);
      if (unhandled || blurredEditor) quickCompose.close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  const markEdited = () => quickCompose.markEdited(kind);

  // A dismissed window stays mounted, hidden, while its session is edited, so
  // the composer keeps its project and environment selections.
  return (
    <div
      className={`${visible ? "flex" : "hidden"} fixed inset-0 z-50 items-start justify-center bg-background/50 px-4 pt-[15vh] backdrop-blur-[3px] max-sm:pt-14`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) quickCompose.close();
      }}
    >
      <section
        ref={windowRef}
        role="dialog"
        aria-label={label}
        className="w-full max-w-[720px] text-foreground"
        onInput={(event) => {
          // Typing in a picker's search box only filters it.
          if (!closestMatch(event.target, PICKER_ROOT)) markEdited();
        }}
        onPaste={markEdited}
        onDrop={markEdited}
        onClick={(event) => {
          if (closestMatch(event.target, PICKER_OPTION)) markEdited();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && closestMatch(event.target, PICKER_ROOT)) {
            markEdited();
          }
        }}
      >
        {children}
      </section>
    </div>
  );
}

function NewThreadWindow({
  session,
  visible,
  focusRequest,
}: {
  session: QuickComposeSession;
  visible: boolean;
  focusRequest: number | undefined;
}) {
  const submit = useSubmitThread("new-thread");
  return (
    <QuickComposeWindow kind="new-thread" label="Quick compose" visible={visible}>
      <NewThreadComposer
        {...(session.projectId === null ? {} : { defaultProjectId: session.projectId })}
        layout="document"
        placeholder="Start a new thread"
        draftKey="quick-compose"
        focusRequest={focusRequest}
        onSubmit={submit}
      />
    </QuickComposeWindow>
  );
}

interface SourceThread {
  projectId: string | null;
  environmentId: string | null;
  title: string;
}

/** The thread being handed off, once the sidebar has loaded. */
function useSourceThread(
  threadId: string,
  fallbackProjectId: string | null,
): SourceThread | undefined {
  const { status, threads } = useSidebarThreads();
  let resolved: SourceThread | undefined;
  if (status !== "loading") {
    const thread = threads.find((candidate) => candidate.id === threadId);
    resolved = {
      projectId: thread?.projectId ?? fallbackProjectId,
      environmentId: thread?.environment?.id ?? null,
      title: thread?.title?.trim() || thread?.titleFallback?.trim() || threadId,
    };
  }
  // Freeze the first answer: changing a composer seed re-seeds every picker,
  // which would undo the user's selections.
  const [source, setSource] = useState(resolved);
  if (source === undefined && resolved !== undefined) setSource(resolved);
  return source ?? resolved;
}

function HandoffComposer({
  sourceThreadId,
  source,
  focusRequest,
}: {
  sourceThreadId: string;
  source: SourceThread;
  focusRequest: number | undefined;
}) {
  const submit = useSubmitThread("handoff");
  const draftKey = `quick-compose-handoff:${sourceThreadId}`;
  // Runs once, before the composer first reads its draft.
  useState(() =>
    seedHandoffDraft(window.localStorage, draftKey, {
      threadId: sourceThreadId,
      projectId: source.projectId,
      title: source.title,
    }),
  );
  const { projectId, environmentId } = source;
  return (
    <NewThreadComposer
      {...(projectId === null ? {} : { defaultProjectId: projectId })}
      {...(environmentId === null
        ? {}
        : { defaultEnvironment: { type: "reuse", environmentId } })}
      layout="document"
      placeholder="Hand off this thread"
      draftKey={draftKey}
      initialPrompt={`${threadMentionToken(sourceThreadId)} `}
      focusRequest={focusRequest}
      onSubmit={submit}
    />
  );
}

function HandoffWindow({
  session,
  sourceThreadId,
  visible,
  focusRequest,
}: {
  session: QuickComposeSession;
  sourceThreadId: string;
  visible: boolean;
  focusRequest: number | undefined;
}) {
  const source = useSourceThread(sourceThreadId, session.projectId);
  return (
    <QuickComposeWindow kind="handoff" label="Quick compose handoff" visible={visible}>
      {source !== undefined && (
        <HandoffComposer
          sourceThreadId={sourceThreadId}
          source={source}
          focusRequest={focusRequest}
        />
      )}
    </QuickComposeWindow>
  );
}

function QuickComposeOverlay() {
  const { active, sessions, focusRequest } = useQuickComposeState();
  const { "new-thread": newThread, handoff } = sessions;
  if (newThread === null && handoff === null) return null;
  // The composer's controls use tooltips, and the app overlay slot mounts
  // outside the host's TooltipProvider. The radix import is shimmed to the
  // host's copy, so this provider feeds the host components.
  return (
    <TooltipProvider delayDuration={300}>
      {newThread !== null && (
        <NewThreadWindow
          key={newThread.id}
          session={newThread}
          visible={active === "new-thread"}
          focusRequest={active === "new-thread" ? focusRequest : undefined}
        />
      )}
      {handoff?.sourceThreadId != null && (
        <HandoffWindow
          key={handoff.id}
          session={handoff}
          sourceThreadId={handoff.sourceThreadId}
          visible={active === "handoff"}
          focusRequest={active === "handoff" ? focusRequest : undefined}
        />
      )}
    </TooltipProvider>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "quick-compose",
    component: QuickComposeOverlay,
  });
  app.commands.register({
    id: "new-thread",
    title: "Quick compose: new thread",
    defaultShortcut: { key: "l", mod: true, shift: true },
    run: (context) => quickCompose.toggle("new-thread", context),
  });
  app.commands.register({
    id: "handoff",
    title: "Quick compose: hand off this thread",
    defaultShortcut: { key: "h", mod: true, shift: true },
    isAvailable: (context) => context.threadId !== null,
    run: (context) => quickCompose.toggle("handoff", context),
  });
});
