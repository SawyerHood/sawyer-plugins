import { useEffect, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { repoAvatarsRpcContract } from "./server.js";

type RepoAvatarsRpc = ReturnType<typeof useRpc<typeof repoAvatarsRpcContract>>;

// One lookup per window: every row shares the same project → avatar map.
let avatars: Readonly<Record<string, string | null>> | null = null;
let loading = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return avatars;
}

async function load(rpc: RepoAvatarsRpc): Promise<void> {
  if (loading || avatars !== null) return;
  loading = true;
  try {
    const result = await rpc.call("repoAvatars", null);
    avatars = result.avatars;
    for (const listener of listeners) listener();
  } catch {
    // No avatars; rows keep their generic project glyph.
  } finally {
    loading = false;
  }
}

/** The GitHub owner avatar for a project's repo, or null without one. */
export function useRepoAvatar(projectId: string): string | null {
  const rpc = useRpc<typeof repoAvatarsRpcContract>();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    void load(rpc);
  }, [rpc]);
  return snapshot?.[projectId] ?? null;
}

export function resetRepoAvatarsForTest(): void {
  avatars = null;
  loading = false;
}
