import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { threadDisplayTitle } from "./inbox";
import { threadIsWorking } from "./lifecycle";

/**
 * How the inbox can be ordered. The list still never re-orders on its own
 * unless the user picks a mode that depends on live fields; "Newest first" is
 * the default and the static order this sidebar was built around.
 */
export const SORT_MODES = [
  "newest",
  "oldest",
  "updated",
  "waiting",
  "attention",
  "title",
  "project",
  "working",
  "provider",
  "workspace",
] as const;

export type SortMode = (typeof SORT_MODES)[number];

export const DEFAULT_SORT_MODE: SortMode = "newest";

export const SORT_LABELS: Record<SortMode, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  updated: "Recently updated",
  waiting: "Waiting longest",
  attention: "Needs attention",
  title: "Title A–Z",
  project: "Project",
  working: "Working first",
  provider: "Provider",
  workspace: "Branch or machine",
};

/**
 * Modes whose order moves as threads change. The static modes only re-order
 * when the user picks them.
 */
export const DYNAMIC_SORT_MODES: ReadonlySet<SortMode> = new Set([
  "updated",
  "waiting",
  "attention",
  "working",
]);

export interface SortGroup {
  label: string;
  modes: readonly SortMode[];
}

/** Recommended modes first; the rest are opt-in extras. */
export const SORT_GROUPS: readonly SortGroup[] = [
  {
    label: "Recommended",
    modes: ["newest", "oldest", "updated", "waiting", "attention", "title"],
  },
  {
    label: "More",
    modes: ["project", "working", "provider", "workspace"],
  },
];

export function isSortMode(value: string): value is SortMode {
  return (SORT_MODES as readonly string[]).includes(value);
}

/** Total, stable order for ties: id last, so equal keys never flicker. */
function byId(left: PluginSidebarThread, right: PluginSidebarThread): number {
  return left.id.localeCompare(right.id);
}

/**
 * Case-insensitive text compare with blanks last. A blank project name or
 * branch should fall to the end, not above every real label.
 */
function compareText(left: string, right: string): number {
  if (left === right) return 0;
  if (left === "") return 1;
  if (right === "") return -1;
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function workspaceLabel(thread: PluginSidebarThread): string {
  // An empty branch name is as good as none: fall through to the machine.
  return thread.environment?.branchName || thread.host?.name || "";
}

function comparator(
  mode: SortMode,
  projectName: (projectId: string) => string,
): (left: PluginSidebarThread, right: PluginSidebarThread) => number {
  switch (mode) {
    case "newest":
      return (left, right) =>
        right.createdAt - left.createdAt || byId(left, right);

    case "oldest":
      return (left, right) =>
        left.createdAt - right.createdAt || byId(left, right);

    case "updated":
      return (left, right) =>
        right.updatedAt - left.updatedAt ||
        right.createdAt - left.createdAt ||
        byId(left, right);

    // bb moves `latestAttentionAt` when a turn finishes, not when the thread is
    // read, so "waiting longest" is the oldest attention first.
    case "waiting":
      return (left, right) =>
        left.latestAttentionAt - right.latestAttentionAt ||
        left.createdAt - right.createdAt ||
        byId(left, right);

    case "attention":
      return (left, right) =>
        Number(right.hasPendingInteraction) -
          Number(left.hasPendingInteraction) ||
        Number(right.isUnread) - Number(left.isUnread) ||
        right.latestAttentionAt - left.latestAttentionAt ||
        right.updatedAt - left.updatedAt ||
        byId(left, right);

    case "title":
      return (left, right) =>
        compareText(
          threadDisplayTitle(left),
          threadDisplayTitle(right),
        ) || byId(left, right);

    case "project":
      return (left, right) =>
        compareText(projectName(left.projectId), projectName(right.projectId)) ||
        right.createdAt - left.createdAt ||
        byId(left, right);

    case "working":
      return (left, right) =>
        Number(threadIsWorking(right)) - Number(threadIsWorking(left)) ||
        right.updatedAt - left.updatedAt ||
        byId(left, right);

    case "provider":
      return (left, right) =>
        compareText(left.providerId, right.providerId) ||
        right.updatedAt - left.updatedAt ||
        byId(left, right);

    case "workspace":
      return (left, right) =>
        compareText(workspaceLabel(left), workspaceLabel(right)) ||
        right.createdAt - left.createdAt ||
        byId(left, right);
  }
}

/**
 * Sort a shelf's threads for display. Always returns a new array and never
 * mutates its input. `projectName` resolves the label the project mode sorts
 * on; pass a stable lookup from the caller's project map.
 */
export function sortThreads(
  threads: readonly PluginSidebarThread[],
  mode: SortMode,
  projectName: (projectId: string) => string,
): PluginSidebarThread[] {
  return [...threads].sort(comparator(mode, projectName));
}
