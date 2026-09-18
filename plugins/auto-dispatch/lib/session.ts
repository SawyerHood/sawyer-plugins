// One Auto session per composer on screen. It outlives the plugin's button:
// BB rebuilds that whenever the composer's project changes, which Auto itself
// causes, and a decision on its way must not be lost or asked for twice. The
// session owns the scheduling, the hold on the composer's send, and the word
// to the user when a round fails.
import type { ExperimentalComposerSelection } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { AUTO_ATTRIBUTE, holdSubmit } from "./composer-dom";
import { changedSelection } from "./fill";
import { createLiveFill, type LiveFill } from "./live-fill";

/** What only a mounted plugin surface can do. Replaced each time one mounts. */
export interface SessionHandles {
  /** Ask the server where `text` should run. */
  route(text: string): Promise<ExperimentalComposerSelection>;
  /** The composer's own `experimental_setSelection`. */
  setSelection(selection: ExperimentalComposerSelection): Promise<unknown>;
}

export interface Session {
  live: LiveFill;
  attach(handles: SessionHandles): void;
  /** How many times Auto has moved this composer's pickers. The wand casts on each. */
  getCasts(): number;
  subscribeCasts(listener: () => void): () => void;
}

interface Entry {
  session: Session;
  surfaces: number;
  disposeTimer: ReturnType<typeof setTimeout> | null;
  dispose(): void;
}

/** BB swaps the old button for the new within one render; this only has to outlast that. */
const DETACHED_GRACE_MS = 250;

/** No surface is mounted to act through. Expected while BB rebuilds it, so not shown. */
class DetachedError extends Error {}

const entries = new WeakMap<HTMLElement, Entry>();

function createEntry(root: HTMLElement): Entry {
  let handles: SessionHandles | null = null;
  let lastToasted: string | null = null;
  let casts = 0;
  const castListeners = new Set<() => void>();
  const current = (): SessionHandles => {
    if (handles === null || entry.surfaces === 0) throw new DetachedError("Auto is not on screen.");
    return handles;
  };

  const live = createLiveFill<ExperimentalComposerSelection>({
    route: async (text) => current().route(text),
    apply: async (selection, previous) => {
      const changed = changedSelection(previous, selection);
      if (Object.keys(changed).length === 0) return;
      await current().setSelection(changed);
      casts += 1;
      for (const listener of [...castListeners]) listener();
    },
    now: () => Date.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });

  const releaseHold = holdSubmit(root, () => live.getSnapshot().pending);
  const unsubscribe = live.subscribe(() => {
    const { pending, error } = live.getSnapshot();
    if (pending) root.setAttribute(AUTO_ATTRIBUTE, "pending");
    else root.removeAttribute(AUTO_ATTRIBUTE);
    if (error === null) {
      // A round that worked makes the next failure news again.
      if (!pending) lastToasted = null;
      return;
    }
    // Said once, not on every keystroke that fails the same way.
    if (error === lastToasted || entry.surfaces === 0) return;
    lastToasted = error;
    toast.error(`Auto: ${error}`);
  });

  const entry: Entry = {
    session: {
      live,
      attach(next) {
        handles = next;
      },
      getCasts: () => casts,
      subscribeCasts(listener) {
        castListeners.add(listener);
        return () => {
          castListeners.delete(listener);
        };
      },
    },
    surfaces: 0,
    disposeTimer: null,
    dispose() {
      unsubscribe();
      castListeners.clear();
      releaseHold();
      live.dispose();
      root.removeAttribute(AUTO_ATTRIBUTE);
      entries.delete(root);
    },
  };
  return entry;
}

/** The session of the composer at `root`, for a plugin surface that has just mounted in it. */
export function acquireSession(root: HTMLElement): Session {
  let entry = entries.get(root);
  if (entry === undefined) {
    entry = createEntry(root);
    entries.set(root, entry);
  }
  if (entry.disposeTimer !== null) {
    clearTimeout(entry.disposeTimer);
    entry.disposeTimer = null;
  }
  entry.surfaces += 1;
  // A round that found nothing to act through while the surface was away.
  entry.session.live.retry();
  return entry.session;
}

/** That surface is unmounting. The session ends unless another takes its place at once. */
export function releaseSession(root: HTMLElement): void {
  const entry = entries.get(root);
  if (entry === undefined) return;
  entry.surfaces -= 1;
  if (entry.surfaces > 0 || entry.disposeTimer !== null) return;
  entry.disposeTimer = setTimeout(() => entry.dispose(), DETACHED_GRACE_MS);
}
