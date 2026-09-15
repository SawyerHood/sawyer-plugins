// Window-local quick compose state shared by the overlay and the command.
import { useSyncExternalStore } from "react";

export interface QuickComposeState {
  open: boolean;
  /** The project in view when the composer opened; seeds its project picker. */
  projectId: string | null;
  /** Bumped whenever the composer should focus its editor. */
  focusRequest: number;
}

let state: QuickComposeState = {
  open: false,
  projectId: null,
  focusRequest: 0,
};
const listeners = new Set<() => void>();

function update(next: Partial<QuickComposeState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const quickCompose = {
  open(projectId: string | null): void {
    update({ open: true, projectId, focusRequest: state.focusRequest + 1 });
  },
  close(): void {
    update({ open: false });
  },
  toggle(projectId: string | null): void {
    if (state.open) quickCompose.close();
    else quickCompose.open(projectId);
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
