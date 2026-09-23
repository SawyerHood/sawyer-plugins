// @vitest-environment jsdom

import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import type {
  PluginSidebarPullRequest,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { TooltipProvider } from "../../vendor/shared-ui/components/ui/tooltip.js";
import { makeSidebarThread } from "../../app/model/fixtures.js";
import { toSidebarThread } from "../../app/model/sidebar-thread.js";
import { ThreadRow } from "../../app/rows/ThreadRow.js";
import { resetRepoAvatarsForTest } from "../repo-avatars/useRepoAvatar.js";

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
}: {
  detailed: boolean;
  thread?: PluginSidebarThread;
  pullRequest?: PluginSidebarPullRequest;
  avatars?: Record<string, string | null>;
}) {
  return renderSlot(
    { component: Harness },
    { thread },
    {
      settings: { detailedRows: detailed },
      sidebarThreads: { threads: [thread], projects: [PROJECT] },
      sidebarPullRequests: pullRequest ? { [thread.id]: pullRequest } : {},
      rpc: { repoAvatars: async () => ({ avatars }) },
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
      branchName: "t3code/827fb93f",
      path: "/work/bb",
      isWorktree: true,
      providerId: null,
      workspaceDisplayKind: null,
    },
    host: { id: "host_bee", name: "bee" },
    ...overrides,
  });
}

const detail = (container: HTMLElement, part: string) =>
  container.querySelector(`[data-sidebar-thread-detail="${part}"]`);

afterEach(() => {
  cleanup();
  resetRepoAvatarsForTest();
});

describe("detailed thread rows", () => {
  it("keeps the one-line row when detailed mode is off", () => {
    const { container } = renderRow({ detailed: false, thread: worktreeThread() });
    expect(detail(container, "header")).toBeNull();
    expect(detail(container, "footer")).toBeNull();
    expect(
      container.querySelector("[data-sidebar-thread-provider-icon]"),
    ).not.toBeNull();
  });

  it("shows project, status, title, branch, machine, and provider", () => {
    const { container } = renderRow({
      detailed: true,
      thread: worktreeThread({ status: "error" }),
    });
    const header = detail(container, "header");
    expect(header?.textContent).toBe("bb");
    expect(
      header?.querySelector('[aria-label="Unread thread failed"]'),
    ).not.toBeNull();
    expect(container.querySelector(".bb-thread-title")).not.toBeNull();
    expect(detail(container, "branch")?.textContent).toBe("t3code/827fb93f");
    expect(detail(container, "machine")?.textContent).toBe("bee");
    const provider = detail(container, "footer")?.querySelector(
      "[data-sidebar-thread-provider-icon]",
    );
    expect(provider?.getAttribute("data-sidebar-thread-provider-icon")).toBe(
      "codex",
    );
    // The status glyph moves to the header, so it is drawn only once.
    expect(
      container.querySelectorAll("[data-sidebar-thread-trailing-indicator]"),
    ).toHaveLength(1);
  });

  it("shows the working glyph in the header while the agent runs", () => {
    const { container } = renderRow({
      detailed: true,
      thread: worktreeThread({ status: "active", runtimeStatus: "active" }),
    });
    expect(
      detail(container, "header")?.querySelector('[aria-label="Thread working"]'),
    ).not.toBeNull();
  });

  it("shows the pull request instead of the branch when there is one", () => {
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
    expect(detail(container, "pull-request")?.textContent).toBe(
      "#42 Detailed sidebar rows",
    );
  });

  it("leaves out the branch and machine a thread does not have", () => {
    const { container } = renderRow({
      detailed: true,
      thread: makeSidebarThread({ lastReadAt: 1, latestAttentionAt: 1 }),
    });
    expect(detail(container, "branch")).toBeNull();
    expect(detail(container, "machine")).toBeNull();
    expect(
      container.querySelector("[data-sidebar-thread-trailing-indicator]"),
    ).toBeNull();
  });

  it("lets the row link cover the whole card", () => {
    const { container } = renderRow({ detailed: true, thread: worktreeThread() });
    const link = container.querySelector("a[data-sidebar-thread-id]");
    expect(link?.parentElement?.className).toContain("static");
    expect(detail(container, "header")?.className).toContain(
      "pointer-events-none",
    );
    expect(detail(container, "footer")?.className).toContain(
      "pointer-events-none",
    );
  });

  it("shows the repo owner's avatar for the project", async () => {
    const { container } = renderRow({
      detailed: true,
      thread: worktreeThread(),
      avatars: { proj_test: "https://avatars.githubusercontent.com/u/1?s=64" },
    });
    await waitFor(() =>
      expect(
        detail(container, "repo-avatar")?.getAttribute("src"),
      ).toBe("https://avatars.githubusercontent.com/u/1?s=64"),
    );
  });

  it("draws a divider under each card", () => {
    const { container } = renderRow({ detailed: true, thread: worktreeThread() });
    expect(
      container.querySelector("[data-sidebar-thread-divider]"),
    ).not.toBeNull();
  });
});
