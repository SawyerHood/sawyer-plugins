// Seeds a handoff draft with a real @thread mention pill.
//
// `NewThreadComposer`'s `initialPrompt` only seeds plain text, so the mention
// renders as raw `@thread:thr_…`. Until the composer can seed mentions, write
// the draft to the host's prompt draft storage before the composer mounts. The
// key and shape mirror bb's usePromptDraftStorage (storage version 3); if they
// drift, the host ignores the entry and `initialPrompt` still seeds plain text.

export interface HandoffSource {
  threadId: string;
  projectId: string | null;
  title: string;
}

export function pluginDraftStorageKey(draftKey: string): string {
  return `bb.promptbox.contents-plugin-draft-${encodeURIComponent(draftKey.trim())}-3`;
}

export function threadMentionToken(threadId: string): string {
  return `@thread:${threadId}`;
}

export function handoffDraft({ threadId, projectId, title }: HandoffSource) {
  const token = threadMentionToken(threadId);
  return {
    text: `${token} `,
    mentions: [
      {
        start: 0,
        end: token.length,
        resource: {
          kind: "thread",
          threadId,
          ...(projectId === null ? {} : { projectId }),
          label: title,
        },
      },
    ],
    attachments: [],
  };
}

/** Writes the handoff draft unless the user already has one under this key. */
export function seedHandoffDraft(
  storage: Pick<Storage, "getItem" | "setItem">,
  draftKey: string,
  source: HandoffSource,
): void {
  const key = pluginDraftStorageKey(draftKey);
  try {
    if (storage.getItem(key) !== null) return;
    storage.setItem(key, JSON.stringify(handoffDraft(source)));
  } catch {
    // Storage is unavailable or full; `initialPrompt` seeds plain text instead.
  }
}
