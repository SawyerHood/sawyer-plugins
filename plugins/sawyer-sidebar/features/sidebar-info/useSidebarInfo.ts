import { useEffect, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { sidebarInfoRpcContract } from "./server.js";

type SidebarInfoRpc = ReturnType<typeof useRpc<typeof sidebarInfoRpcContract>>;

interface SidebarInfo {
  avatars: Readonly<Record<string, string | null>>;
  localHostId: string | null;
}

// One lookup per window, shared by every row.
let info: SidebarInfo | null = null;
let loading = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SidebarInfo | null {
  return info;
}

async function load(rpc: SidebarInfoRpc): Promise<void> {
  if (loading || info !== null) return;
  loading = true;
  try {
    info = await rpc.call("sidebarInfo", null);
    for (const listener of listeners) listener();
  } catch {
    // Rows keep the generic project glyph and show every machine name.
  } finally {
    loading = false;
  }
}

function useSidebarInfo(): SidebarInfo | null {
  const rpc = useRpc<typeof sidebarInfoRpcContract>();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    void load(rpc);
  }, [rpc]);
  return snapshot;
}

/** The GitHub owner avatar for a project's repo, or null without one. */
export function useRepoAvatar(projectId: string): string | null {
  return useSidebarInfo()?.avatars[projectId] ?? null;
}

/** The machine bb's server runs on; null until known or when unmatched. */
export function useLocalHostId(): string | null {
  return useSidebarInfo()?.localHostId ?? null;
}

export function resetSidebarInfoForTest(): void {
  info = null;
  loading = false;
}
