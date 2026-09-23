// @vitest-environment jsdom

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PluginSidebarPullRequest,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { TooltipProvider } from "../../vendor/shared-ui/components/ui/tooltip.js";
import { makeSidebarThread } from "../../app/model/fixtures.js";
import { toSidebarThread } from "../../app/model/sidebar-thread.js";
import { ThreadRow } from "../../app/rows/ThreadRow.js";
import { resetSidebarInfoForTest } from "../sidebar-info/useSidebarInfo.js";
import { detailedRowClass, shortBranchName } from "./DetailedThreadRow.js";

function Harness({ thread }: { thread: PluginSidebarThread }) {
  return (
    <TooltipProvider>
      <ThreadRow
        projectId={thread.projectId}
        thread={toSidebarThread(thread)}
        crossProjectId={null}
        isActive={false}
        options={{ kind: "default", depth: 1, isCompact: false }}
      />
    </TooltipProvider>
  );
}

const PROJECT = {
  id: "proj_test",
  name: "bb",
  isPersonal: false,
  href: "/projects/proj_test",
  settingsHref: "/projects/proj_test/settings",
};

function renderRow({
  detailed,
  thread = makeSidebarThread(),
  pullRequest,
  avatars = {},
  localHostId = null,
}: {
  detailed: boolean;
  thread?: PluginSidebarThread;
  pullRequest?: PluginSidebarPullRequest;
  avatars?: Record<string, string | null>;
  localHostId?: string | null;
}) {
  return renderSlot(
    { component: Harness },
    { thread },
    {
      settings: { detailedRows: detailed },
      sidebarThreads: { threads: [thread], projects: [PROJECT] },
      sidebarPullRequests: pullRequest ? { [thread.id]: pullRequest } : {},
      rpc: { sidebarInfo: async () => ({ avatars, localHostId }) },
    },
  );
}

function worktreeThread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return makeSidebarThread({
    providerId: "codex",
    environment: {
      id: "env_1",
      name: null,
      branchName: "bb/make-the-sidebar-plugin-forkable-thr_tp8gpadn7t",
      path: "/work/bb",
      isWorktree: true,
      providerId: null,
      workspaceDisplayKind: null,
    },
    host: { id: "host_smoothbrain", name: "smoothbrain" },
    ...overrides,
  });
}

const detail = (container: HTMLElement, part: string) =>
  container.querySelector(`[data-sidebar-thread-detail="${part}"]`);

afterEach(() => {
  cleanup();
  resetSidebarInfoForTest();
});

describe("shortBranchName", () => {
  it("keeps the slug of a bb thread branch", () => {
    expect(
      shortBranchName("bb/clone-bb-sidebar-and-add-features-thr_b4ygfq2d3j"),
    ).toBe("clone-bb-sidebar-and-add-features");
  });

  it.each(["main", "release/0.43.4", "bb/no-thread-id", "feature/x-thr_1"])(
    "leaves %s alone",
    (branch) => {
      expect(shortBranchName(branch)).toBe(branch);
    },
  );
});

describe("detailedRowClass", () => {
  it("drops the spacing between a parent with open children and its child", () => {
    expect(detailedRowClass({ isChild: false, hasOpenChildren: true })).toContain(
      "border-b-0",
    );
    expect(detailedRowClass({ isChild: true, hasOpenChildren: false })).toContain(
      "border-t-0",
    );
    const standalone = detailedRowClass({ isChild: false, hasOpenChildren: false });
    expect(standalone).not.toContain("border-t-0");
    expect(standalone).not.toContain("border-b-0");
  });
});

describe("detailed thread rows", () => {
  it("keeps the one-line row when detailed mode is off", () => {
    const { container } = renderRow({ detailed: false, thread: worktreeThread() });
    expect(detail(container, "meta")).toBeNull();
    expect(
      container.querySelector("[data-sidebar-thread-provider-icon]"),
    ).not.toBeNull();
  });

  it("puts the title and status first, then project, branch, machine, and provider", () => {
    const { container } = renderRow({
      detailed: true,
      thread: worktreeThread({ status: "error" }),
    });
    expect(container.querySelector(".bb-thread-title")).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Unread thread failed"]'),
    ).not.toBeNull();
    const meta = detail(container, "meta");
    expect(meta?.querySelector('[aria-label="Unread thread failed"]')).toBeNull();
    expect(detail(container, "project")?.textContent).toBe("bb");
    expect(detail(container, "branch")?.textContent).toBe(
      "make-the-sidebar-plugin-forkable",
    );
    expect(detail(container, "machine")?.textContent).toBe("smoothbrain");
    expect(
      meta
        ?.querySelector("[data-sidebar-thread-provider-icon]")
        ?.getAttribute("data-sidebar-thread-provider-icon"),
    ).toBe("codex");
    // Only one provider icon: the leading one is dropped in detailed mode.
    expect(
      container.querySelectorAll("[data-sidebar-thread-provider-icon]"),
    ).toHaveLength(1);
  });

  it("leaves out the machine bb runs on", async () => {
    const { container } = renderRow({
      detailed: true,
      thread: worktreeThread(),
      localHostId: "host_smoothbrain",
    });
    await waitFor(() => expect(detail(container, "machine")).toBeNull());
  });

  it("shows the pull request number instead of the branch", () => {
    const { container } = renderRow({
      detailed: true,
      thread: worktreeThread(),
      pullRequest: {
        number: 42,
        title: "Detailed sidebar rows",
        url: "https://github.com/example/repo/pull/42",
        state: "open",
        attention: "none",
      },
    });
    expect(detail(container, "branch")).toBeNull();
    expect(detail(container, "pull-request")?.textContent).toBe("#42");
  });

  it("leaves out the branch and machine a thread does not have", () => {
    const { container } = renderRow({ detailed: true });
    expect(detail(container, "branch")).toBeNull();
    expect(detail(container, "machine")).toBeNull();
  });

  it("shows the repo owner's avatar for the project", async () => {
    const { container } = renderRow({
      detailed: true,
      thread: worktreeThread(),
      avatars: { proj_test: "https://avatars.githubusercontent.com/u/1?s=64" },
    });
    await waitFor(() =>
      expect(detail(container, "repo-avatar")?.getAttribute("src")).toBe(
        "https://avatars.githubusercontent.com/u/1?s=64",
      ),
    );
  });

  it("lets the row link cover the whole card", () => {
    const { container } = renderRow({ detailed: true, thread: worktreeThread() });
    const link = container.querySelector("a[data-sidebar-thread-id]");
    expect(link?.parentElement?.className).toContain("static");
    expect(detail(container, "meta")?.className).toContain(
      "pointer-events-none",
    );
  });
});
