// Window-local quick chat state shared by the overlay, the plugin commands,
// and the sidebar footer action.
import { useSyncExternalStore } from "react";

export interface QuickChatState {
  open: boolean;
  /** The chat shown in the window; null shows the new chat view. */
  threadId: string | null;
  /** Bumped whenever the window should focus its composer. */
  focusRequest: number;
}

const THREAD_STORAGE_KEY = "bb-plugin-quick-chat:thread-id";

function readStoredThreadId(): string | null {
  try {
    const value = window.localStorage.getItem(THREAD_STORAGE_KEY);
    return value !== null && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function storeThreadId(threadId: string | null): void {
  try {
    if (threadId === null) window.localStorage.removeItem(THREAD_STORAGE_KEY);
    else window.localStorage.setItem(THREAD_STORAGE_KEY, threadId);
  } catch {
    // Storage can be unavailable; the chat simply won't survive a reload.
  }
}

let state: QuickChatState = {
  open: false,
  threadId: readStoredThreadId(),
  focusRequest: 0,
};
const listeners = new Set<() => void>();

function update(next: Partial<QuickChatState>): void {
  state = { ...state, ...next };
  if (next.threadId !== undefined) storeThreadId(next.threadId);
  for (const listener of listeners) listener();
}

export const quickChat = {
  open(): void {
    update({ open: true, focusRequest: state.focusRequest + 1 });
  },
  close(): void {
    update({ open: false });
  },
  toggle(): void {
    if (state.open) quickChat.close();
    else quickChat.open();
  },
  newChat(): void {
    update({
      open: true,
      threadId: null,
      focusRequest: state.focusRequest + 1,
    });
  },
  showChat(threadId: string): void {
    update({ open: true, threadId, focusRequest: state.focusRequest + 1 });
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useQuickChatState(): QuickChatState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export function formatRelativeTime(timestamp: number, now: number): string {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
