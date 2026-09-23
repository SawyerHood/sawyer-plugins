import type { ReactNode } from "react";
import {
  experimental_useSidebarThreadPullRequest as useSidebarThreadPullRequest,
  useSettings,
  type PluginSidebarPullRequest,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "../../vendor/shared-ui/components/ui/icon.js";
import { cn } from "../../vendor/shared-ui/lib/utils.js";
import type { SidebarThread } from "../../app/model/sidebar-thread.js";
import {
  useSidebarData,
  useSidebarProjectName,
} from "../../app/model/use-sidebar-data.js";
import { ThreadProviderIcon } from "../provider-icon/ThreadProviderIcon.js";
import { DETAILED_ROWS_SETTING } from "./settings.js";

export function useDetailedRows(): boolean {
  return useSettings().values?.[DETAILED_ROWS_SETTING] === true;
}

/** Row classes for detailed mode: a padded column instead of a fixed-height line. */
export const DETAILED_ROW_CLASS = "h-auto flex-col items-stretch gap-0.5 py-1.5";

interface StatusText {
  text: string;
  className: string;
}

const MUTED = "text-muted-foreground";
const ACTIVE = "text-sky-600 dark:text-sky-400";

/** The t3code-style word shown in the card's upper right, per status. */
const STATUS_TEXT: Record<string, StatusText | null> = {
  "unread-error": { text: "Failed", className: "text-destructive" },
  "queued-failed": { text: "Send failed", className: "text-destructive" },
  "waiting-for-input": {
    text: "Needs input",
    className: "text-amber-600 dark:text-amber-400",
  },
  runtime: { text: "Working", className: ACTIVE },
  "working-draft": { text: "Working", className: ACTIVE },
  workflow: { text: "Workflow", className: ACTIVE },
  "background-agent": { text: "Agents running", className: ACTIVE },
  "background-command": { text: "Running", className: ACTIVE },
  "plan-mode": { text: "Planning", className: ACTIVE },
  goal: { text: "Goal", className: ACTIVE },
  "queued-waiting": { text: "Queued", className: MUTED },
  draft: { text: "Draft", className: MUTED },
  "unread-success": {
    text: "Completed",
    className: "text-emerald-600 dark:text-emerald-400",
  },
  archived: { text: "Archived", className: MUTED },
  none: null,
};

export function statusTextFor(indicatorKind: string): StatusText | null {
  return STATUS_TEXT[indicatorKind] ?? null;
}

function pullRequestIcon(pullRequest: PluginSidebarPullRequest): string {
  if (pullRequest.state === "merged") return "GitMerge";
  if (pullRequest.state === "closed") return "GitPullRequestClosed";
  if (pullRequest.state === "draft") return "GitPullRequestDraft";
  return "GitPullRequest";
}

function BranchOrPullRequest({ thread }: { thread: SidebarThread }) {
  const { pullRequest } = useSidebarThreadPullRequest(thread.id);
  if (pullRequest !== null) {
    return (
      <span
        data-sidebar-thread-detail="pull-request"
        className="flex min-w-0 items-center gap-1"
      >
        <Icon
          name={pullRequestIcon(pullRequest)}
          className="size-3 shrink-0"
          aria-hidden
        />
        <span className="truncate">
          #{pullRequest.number} {pullRequest.title}
        </span>
      </span>
    );
  }
  if (thread.environmentBranchName === null) return null;
  return (
    <span
      data-sidebar-thread-detail="branch"
      className="flex min-w-0 items-center gap-1"
    >
      <Icon name="GitBranch" className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{thread.environmentBranchName}</span>
    </span>
  );
}

interface DetailedThreadRowProps {
  thread: SidebarThread;
  status: StatusText | null;
  /** The regular row content: title, rename editor, and hover actions. */
  children: ReactNode;
}

/**
 * A three-line thread card in the style of t3code: project and status, then
 * the regular title row, then branch or pull request with the machine and
 * provider. Only the title row takes pointer events; the row link underneath
 * covers the whole card, so a click anywhere opens the thread.
 */
export function DetailedThreadRow({
  thread,
  status,
  children,
}: DetailedThreadRowProps) {
  const projectName = useSidebarProjectName(thread.projectId);
  const { hostsById } = useSidebarData();
  const machineName =
    thread.environmentHostId === null
      ? null
      : (hostsById.get(thread.environmentHostId)?.name ?? null);
  return (
    <>
      <span
        data-sidebar-thread-detail="header"
        className="pointer-events-none flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Icon name="Code" className="size-3 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{projectName ?? ""}</span>
        {status !== null ? (
          <span
            data-sidebar-thread-status-text=""
            className={cn("shrink-0 font-medium", status.className)}
          >
            {status.text}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      <span
        data-sidebar-thread-detail="footer"
        className="pointer-events-none flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
      >
        <span className="min-w-0 flex-1">
          <BranchOrPullRequest thread={thread} />
        </span>
        {machineName !== null ? (
          <span
            data-sidebar-thread-detail="machine"
            className="flex min-w-0 max-w-[45%] items-center gap-1"
          >
            <Icon name="Laptop" className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{machineName}</span>
          </span>
        ) : null}
        <ThreadProviderIcon providerId={thread.providerId} />
      </span>
    </>
  );
}
