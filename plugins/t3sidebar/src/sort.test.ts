import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import {
  DEFAULT_SORT_MODE,
  SORT_GROUPS,
  SORT_MODES,
  isSortMode,
  sortThreads,
} from "./sort";

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "thr_1",
    projectId: "proj_1",
    title: "A thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 100,
    updatedAt: 100,
    lastReadAt: 100,
    latestAttentionAt: 100,
    ...overrides,
  };
}

const ids = (threads: readonly PluginSidebarThread[]) =>
  threads.map((thread) => thread.id);

/** No project names: the project mode sorts every label the same. */
const noProjects = () => "";

describe("sortThreads", () => {
  it("defaults to newest first, with id as a stable tiebreak", () => {
    expect(DEFAULT_SORT_MODE).toBe("newest");
    const ordered = sortThreads(
      [
        thread({ id: "b", createdAt: 5 }),
        thread({ id: "a", createdAt: 5 }),
        thread({ id: "c", createdAt: 9 }),
      ],
      "newest",
      noProjects,
    );
    expect(ids(ordered)).toEqual(["c", "a", "b"]);
  });

  it("sorts oldest first", () => {
    const ordered = sortThreads(
      [
        thread({ id: "b", createdAt: 5 }),
        thread({ id: "a", createdAt: 1 }),
        thread({ id: "c", createdAt: 9 }),
      ],
      "oldest",
      noProjects,
    );
    expect(ids(ordered)).toEqual(["a", "b", "c"]);
  });

  it("sorts by most recently updated, then created", () => {
    const ordered = sortThreads(
      [
        thread({ id: "a", updatedAt: 10, createdAt: 1 }),
        thread({ id: "b", updatedAt: 30, createdAt: 1 }),
        thread({ id: "c", updatedAt: 30, createdAt: 2 }),
      ],
      "updated",
      noProjects,
    );
    expect(ids(ordered)).toEqual(["c", "b", "a"]);
  });

  it("puts the longest-waiting attention first", () => {
    const ordered = sortThreads(
      [
        thread({ id: "b", latestAttentionAt: 30 }),
        thread({ id: "a", latestAttentionAt: 10 }),
        thread({ id: "c", latestAttentionAt: 20 }),
      ],
      "waiting",
      noProjects,
    );
    expect(ids(ordered)).toEqual(["a", "c", "b"]);
  });

  it("puts pending interaction, then unread, then newest attention first", () => {
    const ordered = sortThreads(
      [
        thread({ id: "calm", latestAttentionAt: 500 }),
        thread({ id: "unread", isUnread: true, latestAttentionAt: 100 }),
        thread({ id: "asking", hasPendingInteraction: true }),
      ],
      "attention",
      noProjects,
    );
    expect(ids(ordered)).toEqual(["asking", "unread", "calm"]);
  });

  it("sorts titles case-insensitively", () => {
    const ordered = sortThreads(
      [
        thread({ id: "b", title: "beta" }),
        thread({ id: "a", title: "Alpha" }),
        thread({ id: "c", title: "gamma" }),
      ],
      "title",
      noProjects,
    );
    expect(ids(ordered)).toEqual(["a", "b", "c"]);
  });

  it("sorts by project name, with blanks last", () => {
    const names: Record<string, string> = {
      p_zeta: "zeta",
      p_alpha: "alpha",
    };
    const ordered = sortThreads(
      [
        thread({ id: "a", projectId: "p_zeta" }),
        thread({ id: "b", projectId: "p_alpha" }),
        thread({ id: "c", projectId: "p_unknown" }),
      ],
      "project",
      (projectId) => names[projectId] ?? "",
    );
    expect(ids(ordered)).toEqual(["b", "a", "c"]);
  });

  it("puts working threads first, then most recently updated", () => {
    const ordered = sortThreads(
      [
        thread({ id: "idle", updatedAt: 50 }),
        thread({ id: "busy", indicator: "runtime", updatedAt: 5 }),
      ],
      "working",
      noProjects,
    );
    expect(ids(ordered)).toEqual(["busy", "idle"]);
  });

  it("counts background commands as working", () => {
    const ordered = sortThreads(
      [
        thread({ id: "idle", updatedAt: 50 }),
        thread({
          id: "busy",
          updatedAt: 5,
          activity: {
            workflows: 0,
            backgroundAgents: 0,
            backgroundCommands: 1,
            planMode: 0,
            goals: 0,
          },
        }),
      ],
      "working",
      noProjects,
    );
    expect(ids(ordered)).toEqual(["busy", "idle"]);
  });

  it("sorts by provider, then most recently updated", () => {
    const ordered = sortThreads(
      [
        thread({ id: "a", providerId: "zeta", updatedAt: 50 }),
        thread({ id: "b", providerId: "alpha", updatedAt: 10 }),
        thread({ id: "c", providerId: "alpha", updatedAt: 20 }),
      ],
      "provider",
      noProjects,
    );
    expect(ids(ordered)).toEqual(["c", "b", "a"]);
  });

  it("sorts by branch or machine, with blanks last", () => {
    const ordered = sortThreads(
      [
        thread({
          id: "a",
          environment: {
            id: "env_1",
            name: "Worktree",
            branchName: "zeta",
            workspaceDisplayKind: "managed-worktree",
          },
        }),
        thread({ id: "b", host: { id: "host_1", name: "alpha" } }),
        thread({ id: "c" }),
      ],
      "workspace",
      noProjects,
    );
    expect(ids(ordered)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate its input", () => {
    const input = [
      thread({ id: "a", createdAt: 1 }),
      thread({ id: "b", createdAt: 2 }),
    ];
    sortThreads(input, "newest", noProjects);
    expect(ids(input)).toEqual(["a", "b"]);
  });
});

describe("sort modes", () => {
  it("recognizes only known modes", () => {
    expect(isSortMode("newest")).toBe(true);
    expect(isSortMode("bogus")).toBe(false);
  });

  it("starts the recommended group with the static default", () => {
    expect(SORT_GROUPS[0]?.modes[0]).toBe(DEFAULT_SORT_MODE);
    expect(new Set(SORT_MODES).size).toBe(SORT_MODES.length);
  });
});
