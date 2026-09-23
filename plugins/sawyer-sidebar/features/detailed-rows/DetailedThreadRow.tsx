import { useState, type ReactNode } from "react";
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
import {
  useLocalHostId,
  useRepoAvatar,
} from "../sidebar-info/useSidebarInfo.js";
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
const DETAILED_ROW_CLASS =
  "h-auto flex-col items-stretch gap-px border-y border-transparent bg-clip-padding py-1 pr-2.5";

/**
 * Card classes for one row. A parent with its children showing and each child
 * give up the spacing between them, so a thread tree reads as one unit while
 * separate threads keep their gap.
 */
export function detailedRowClass({
  isChild,
  hasOpenChildren,
}: {
  isChild: boolean;
  hasOpenChildren: boolean;
}): string {
  return [
    DETAILED_ROW_CLASS,
    isChild && "border-t-0 pt-0.5",
    hasOpenChildren && "border-b-0 pb-0.5",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The title row centers its status glyph in the row-action box
 * (`COARSE_POINTER_ROW_ACTION_SIZE_CLASS`: w-7, w-9 on coarse pointers). A slot
 * of the same width puts the provider icon directly under the glyph.
 */
const PROVIDER_SLOT_CLASS =
  "flex w-7 shrink-0 justify-center max-md:pointer-coarse:w-9";

/**
 * bb names a thread's worktree branch `bb/<title-slug>-<thread id>`. The slug
 * is the useful part, so drop the prefix and id; other branches stay whole.
 */
export function shortBranchName(branch: string): string {
  return /^bb\/(.+)-thr_[a-z0-9]+$/i.exec(branch)?.[1] ?? branch;
}

/** The repo owner's GitHub avatar, or a generic code glyph without one. */
function ProjectGlyph({ projectId }: { projectId: string }) {
  const avatarUrl = useRepoAvatar(projectId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (avatarUrl !== null && avatarUrl !== failedUrl) {
    return (
      <img
        data-sidebar-thread-detail="repo-avatar"
        src={avatarUrl}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setFailedUrl(avatarUrl)}
        className="size-3.5 shrink-0 rounded-[3px]"
      />
    );
  }
  return <Icon name="Code" className="size-3 shrink-0" aria-hidden />;
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
        <span className="truncate">#{pullRequest.number}</span>
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
      <span className="truncate">
        {shortBranchName(thread.environmentBranchName)}
      </span>
    </span>
  );
}

/** The thread's machine, left out when it is the machine bb runs on. */
function useRemoteMachineName(thread: SidebarThread): string | null {
  const { hostsById } = useSidebarData();
  const localHostId = useLocalHostId();
  const hostId = thread.environmentHostId;
  if (hostId === null || hostId === localHostId) return null;
  return hostsById.get(hostId)?.name ?? null;
}

interface DetailedThreadRowProps {
  thread: SidebarThread;
  /** The regular row: title, status glyph, rename editor, and hover actions. */
  children: ReactNode;
}

/**
 * A two-line thread card: the regular title row, then one quieter line with
 * the repo avatar, project, branch or pull request, the machine when it is not
 * this one, and the provider. The row link underneath covers the whole card,
 * so a click anywhere opens the thread.
 */
export function DetailedThreadRow({ thread, children }: DetailedThreadRowProps) {
  const projectName = useSidebarProjectName(thread.projectId);
  const machineName = useRemoteMachineName(thread);
  return (
    <>
      {/* Hold the title line to its text height; the 28px row-action box
          overhangs it, centered, instead of stretching the card. */}
      <span className="flex h-5 min-w-0 items-center gap-2 font-medium">
        {children}
      </span>
      <span
        data-sidebar-thread-detail="meta"
        className="pointer-events-none flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground/80"
      >
        <ProjectGlyph projectId={thread.projectId} />
        {projectName ? (
          <span
            data-sidebar-thread-detail="project"
            className="max-w-[40%] shrink-0 truncate"
          >
            {projectName}
          </span>
        ) : null}
        <span aria-hidden className="shrink-0 opacity-50">
          ·
        </span>
        <span className="min-w-0 flex-1">
          <BranchOrPullRequest thread={thread} />
        </span>
        {machineName !== null ? (
          <span
            data-sidebar-thread-detail="machine"
            className="flex min-w-0 max-w-[40%] shrink-0 items-center gap-1"
          >
            <Icon name="Laptop" className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{machineName}</span>
          </span>
        ) : null}
        <span
          data-sidebar-thread-detail="provider"
          className={PROVIDER_SLOT_CLASS}
        >
          <ThreadProviderIcon providerId={thread.providerId} />
        </span>
      </span>
    </>
  );
}
