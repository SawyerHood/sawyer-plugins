import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import {
  definePluginApp,
  experimental_NewThreadComposer as NewThreadComposer,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { quickComposeRpcContract } from "./server";
import {
  quickCompose,
  useQuickComposeState,
} from "@/lib/quick-compose-store";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function QuickComposeWindow({
  projectId,
  focusRequest,
}: {
  projectId: string | null;
  focusRequest: number;
}) {
  const rpc = useRpc<typeof quickComposeRpcContract>();
  const navigate = useBbNavigate();
  const windowRef = useRef<HTMLElement>(null);

  useEffect(() => {
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
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/50 px-4 pt-[15vh] backdrop-blur-[3px] max-sm:pt-14"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) quickCompose.close();
      }}
    >
      <section
        ref={windowRef}
        role="dialog"
        aria-label="Quick compose"
        className="w-full max-w-[720px] text-foreground"
      >
        <NewThreadComposer
          {...(projectId === null ? {} : { defaultProjectId: projectId })}
          layout="document"
          placeholder="Start a new thread"
          draftKey="quick-compose"
          focusRequest={focusRequest}
          onSubmit={async (request) => {
            try {
              const { threadId } = await rpc.call("createThread", { request });
              quickCompose.close();
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
          }}
        />
      </section>
    </div>
  );
}

function QuickComposeOverlay() {
  const { open, projectId, focusRequest } = useQuickComposeState();
  if (!open) return null;
  // The composer's controls use tooltips, and the app overlay slot mounts
  // outside the host's TooltipProvider. The radix import is shimmed to the
  // host's copy, so this provider feeds the host components.
  return (
    <TooltipProvider delayDuration={300}>
      <QuickComposeWindow projectId={projectId} focusRequest={focusRequest} />
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
    run: (context) => quickCompose.toggle(context.projectId),
  });
});
