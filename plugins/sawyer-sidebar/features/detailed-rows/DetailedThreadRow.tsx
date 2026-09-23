import type { ReactNode } from "react";
import {
  experimental_useSidebarThreadPullRequest as useSidebarThreadPullRequest,
  useSettings,
  type PluginSidebarPullRequest,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "../../vendor/shared-ui/components/ui/icon.js";
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

/**
 * Row classes for detailed mode: a padded column instead of a fixed-height
 * line. The transparent top and bottom borders, with the background clipped to
 * the padding box, leave a gap between neighbouring cards' hover and selection
 * without margins, which the windowed list would not measure.
 */
export const DETAILED_ROW_CLASS =
  "h-auto flex-col items-stretch gap-1 border-y-2 border-transparent bg-clip-padding py-2 pr-2.5";

const DETAIL_LINE_CLASS =
  "pointer-events-none flex min-w-0 items-center text-[11px] leading-4 text-muted-foreground/80";

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
  /** The row's status glyph, drawn in the card's upper right. */
  status: ReactNode;
  /** The regular row content: title, rename editor, and hover actions. */
  children: ReactNode;
}

/**
 * A three-line thread card in the style of t3code: project and status glyph, then
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
        className={`${DETAIL_LINE_CLASS} gap-1.5`}
      >
        <Icon name="Code" className="size-3 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{projectName ?? ""}</span>
        {status}
      </span>
      <span className="flex min-w-0 items-center gap-2 font-medium">
        {children}
      </span>
      <span
        data-sidebar-thread-detail="footer"
        className={`${DETAIL_LINE_CLASS} gap-2`}
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
