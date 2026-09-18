import { describe, expect, it, vi } from "vitest";
import { canFillComposer, type ComposerSelection, fillComposer } from "./composer-fiber";

interface FakeFiber {
  return: FakeFiber | null;
  child: FakeFiber | null;
  sibling: FakeFiber | null;
  alternate: FakeFiber | null;
  memoizedProps: unknown;
  stateNode: unknown;
}

function fiber(memoizedProps: unknown = {}): FakeFiber {
  return { return: null, child: null, sibling: null, alternate: null, memoizedProps, stateNode: null };
}

/** Link `fibers` as one line of only children, first to last, under a live root. */
function chain(...fibers: FakeFiber[]): FakeFiber {
  const root = fiber();
  root.stateNode = { current: root };
  let parent = root;
  for (const next of fibers) {
    parent.child = next;
    next.return = parent;
    parent = next;
  }
  return root;
}

function element(own: FakeFiber | null, parentElement: Element | null = null): Element {
  return { ...(own === null ? {} : { __reactFiber$test: own }), parentElement } as unknown as Element;
}

const selection: ComposerSelection = {
  projectId: "proj_b",
  environmentProviderId: "git-worktree",
  hostId: "host_1",
  providerId: "codex",
  model: "gpt",
  reasoningLevel: "medium",
};

/** BB's compose screen and prompt box, with a leaf the plugin's element hangs from. */
function composer(projectId: string) {
  const calls: string[] = [];
  const screen = fiber({
    composer: {
      projectId,
      setEnvironmentSelectionValue: (value: string, hostId: string) =>
        calls.push(`environment ${value} ${hostId} in ${projectId}`),
      setProviderModelReasoning: (next: { providerId: string; model: string; reasoningLevel: string }) =>
        calls.push(`model ${next.providerId} ${next.model} ${next.reasoningLevel}`),
    },
  });
  const changeProject = vi.fn();
  const promptBox = fiber({ project: { onChange: changeProject } });
  const leaf = fiber();
  return { screen, promptBox, leaf, calls, changeProject };
}

describe("canFillComposer", () => {
  it("finds the composer's setters above an element inside it", () => {
    const { screen, promptBox, leaf } = composer("proj_a");
    chain(screen, promptBox, leaf);
    expect(canFillComposer(element(leaf))).toBe(true);
  });

  it("starts from the nearest ancestor React rendered", () => {
    const { screen, promptBox, leaf } = composer("proj_a");
    chain(screen, promptBox, leaf);
    expect(canFillComposer(element(null, element(leaf)))).toBe(true);
  });

  it("is false outside the root New thread composer", () => {
    const leaf = fiber();
    chain(fiber({ project: { onChange: () => {} } }), leaf);
    expect(canFillComposer(element(leaf))).toBe(false);
    expect(canFillComposer(element(null))).toBe(false);
  });
});

describe("fillComposer", () => {
  it("sets the environment, machine, and model when the project already matches", async () => {
    const { screen, promptBox, leaf, calls, changeProject } = composer("proj_b");
    chain(screen, promptBox, leaf);
    await fillComposer(() => element(leaf), selection);
    expect(changeProject).not.toHaveBeenCalled();
    expect(calls).toEqual([
      "environment provider:git-worktree host_1 in proj_b",
      "model codex gpt medium",
    ]);
  });

  it("reads the live copy of a fiber, not the stale one an element may hold", async () => {
    const stale = composer("proj_a");
    const live = composer("proj_b");
    chain(live.screen, live.promptBox, live.leaf);
    // The element still points at the previous render's copies.
    stale.screen.alternate = live.screen;
    stale.promptBox.alternate = live.promptBox;
    stale.leaf.alternate = live.leaf;
    stale.leaf.return = stale.promptBox;
    stale.promptBox.return = stale.screen;
    stale.screen.return = live.screen.return;
    await fillComposer(() => element(stale.leaf), selection);
    expect(stale.calls).toEqual([]);
    expect(live.calls).toHaveLength(2);
  });

  it("switches project first, then uses the setters BB rebuilt for it", async () => {
    const before = composer("proj_a");
    chain(before.screen, before.promptBox, before.leaf);
    const after = composer("proj_b");
    let current: Element | null = element(before.leaf);
    before.changeProject.mockImplementation(() => {
      // BB rebuilds the composer for the new project a moment later.
      current = null;
      setTimeout(() => {
        chain(after.screen, after.promptBox, after.leaf);
        current = element(after.leaf);
      }, 20);
    });
    await fillComposer(() => current, selection);
    expect(before.changeProject).toHaveBeenCalledWith("proj_b");
    expect(before.calls).toEqual([]);
    expect(after.calls).toEqual([
      "environment provider:git-worktree host_1 in proj_b",
      "model codex gpt medium",
    ]);
  });

  it("refuses rather than guesses when the pickers cannot be reached", async () => {
    await expect(fillComposer(() => element(null), selection)).rejects.toThrow(/could not reach/);
  });
});
