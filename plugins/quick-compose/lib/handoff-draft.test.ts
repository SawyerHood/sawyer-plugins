import { describe, expect, it } from "vitest";
import { handoffDraft, pluginDraftStorageKey, seedHandoffDraft } from "./handoff-draft";

const source = { threadId: "thr_abc", projectId: "proj_1", title: "Fix the flaky test" };

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe("handoff draft", () => {
  it("matches the host's plugin draft storage key", () => {
    expect(pluginDraftStorageKey("quick-compose-handoff:thr_abc")).toBe(
      "bb.promptbox.contents-plugin-draft-quick-compose-handoff%3Athr_abc-3",
    );
  });

  it("spans the mention token, not the trailing space", () => {
    const draft = handoffDraft(source);
    expect(draft.text).toBe("@thread:thr_abc ");
    expect(draft.text.slice(draft.mentions[0]!.start, draft.mentions[0]!.end)).toBe(
      "@thread:thr_abc",
    );
    expect(draft.mentions[0]!.resource).toEqual({
      kind: "thread",
      threadId: "thr_abc",
      projectId: "proj_1",
      label: "Fix the flaky test",
    });
  });

  it("seeds an empty key and leaves an existing draft alone", () => {
    const key = pluginDraftStorageKey("handoff");
    const empty = memoryStorage();
    seedHandoffDraft(empty, "handoff", source);
    expect(JSON.parse(empty.items.get(key)!)).toEqual(handoffDraft(source));

    const existing = memoryStorage({ [key]: '{"text":"mine","attachments":[]}' });
    seedHandoffDraft(existing, "handoff", source);
    expect(existing.items.get(key)).toBe('{"text":"mine","attachments":[]}');
  });

  it("ignores storage failures", () => {
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => seedHandoffDraft(failing, "handoff", source)).not.toThrow();
  });
});
