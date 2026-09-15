// Window-local quick compose state shared by the overlay and the commands.
import { useSyncExternalStore } from "react";

export type QuickComposeKind = "new-thread" | "handoff";

export interface QuickComposeSession {
  /** Changes whenever a fresh session starts; keys the composer's mount. */
  id: number;
  /** The project in view when the session started; seeds the project picker. */
  projectId: string | null;
  /** The thread being handed off, or null for a plain new thread. */
  sourceThreadId: string | null;
  /**
   * The user typed or picked something. An edited session survives dismissal
   * and is shown as left until it is submitted.
   */
  edited: boolean;
}

export interface QuickComposeState {
  /** The session on screen, or null while closed. */
  active: QuickComposeKind | null;
  sessions: Record<QuickComposeKind, QuickComposeSession | null>;
  /** Bumped whenever the composer should focus its editor. */
  focusRequest: number;
}

export interface QuickComposeContext {
  projectId: string | null;
  threadId: string | null;
}

let state: QuickComposeState = {
  active: null,
  sessions: { "new-thread": null, handoff: null },
  focusRequest: 0,
};
let nextSessionId = 1;
const listeners = new Set<() => void>();

function update(next: Partial<QuickComposeState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function withSession(
  kind: QuickComposeKind,
  session: QuickComposeSession | null,
): QuickComposeState["sessions"] {
  return { ...state.sessions, [kind]: session };
}

/** Whether the session was started for what `context` is showing. */
function matchesContext(
  kind: QuickComposeKind,
  session: QuickComposeSession,
  context: QuickComposeContext,
): boolean {
  return kind === "new-thread" || session.sourceThreadId === context.threadId;
}

export const quickCompose = {
  open(kind: QuickComposeKind, context: QuickComposeContext): void {
    const current = state.sessions[kind];
    const resume =
      current !== null &&
      current.edited &&
      matchesContext(kind, current, context);
    const session = resume
      ? current
      : {
          id: nextSessionId++,
          projectId: context.projectId,
          sourceThreadId: kind === "handoff" ? context.threadId : null,
          edited: false,
        };
    update({
      active: kind,
      sessions: withSession(kind, session),
      focusRequest: state.focusRequest + 1,
    });
  },
  /** Hides the composer. Untouched sessions are dropped so the next open re-seeds. */
  close(): void {
    const { "new-thread": newThread, handoff } = state.sessions;
    update({
      active: null,
      sessions: {
        "new-thread": newThread?.edited ? newThread : null,
        handoff: handoff?.edited ? handoff : null,
      },
    });
  },
  toggle(kind: QuickComposeKind, context: QuickComposeContext): void {
    const current = state.sessions[kind];
    if (
      state.active === kind &&
      current !== null &&
      matchesContext(kind, current, context)
    ) {
      quickCompose.close();
    } else {
      quickCompose.open(kind, context);
    }
  },
  markEdited(kind: QuickComposeKind): void {
    const current = state.sessions[kind];
    if (current === null || current.edited) return;
    update({ sessions: withSession(kind, { ...current, edited: true }) });
  },
  /** Ends a session after it is submitted. */
  finish(kind: QuickComposeKind): void {
    update({
      active: state.active === kind ? null : state.active,
      sessions: withSession(kind, null),
    });
  },
  getState(): QuickComposeState {
    return state;
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useQuickComposeState(): QuickComposeState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
