// The plugin SDK exposes the composer's text but not its attachments or
// mention pills, so those are read from the draft BB persists for the root
// New thread screen. If BB changes that storage, auto dispatch refuses drafts
// with attachments instead of silently dropping them (see app.tsx).
import { z } from "zod";

export const ROOT_DRAFT_STORAGE_KEY = "bb.promptbox.contents-draft-3";

const attachmentSchema = z.object({
  type: z.enum(["localImage", "localFile"]),
  path: z.string().min(1),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
});
export type DraftAttachment = z.infer<typeof attachmentSchema>;

const mentionSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  resource: z.unknown(),
});
export type DraftMention = z.infer<typeof mentionSchema>;

const storedDraftSchema = z.object({
  text: z.string(),
  mentions: z.array(mentionSchema).optional(),
  attachments: z.array(attachmentSchema).optional(),
});

export interface StoredDraft {
  text: string;
  mentions: DraftMention[];
  attachments: DraftAttachment[];
}

export interface DispatchPayload {
  text: string;
  mentions: DraftMention[];
  attachments: DraftAttachment[];
}

export function parseStoredDraft(raw: string | null): StoredDraft | null {
  if (raw === null) return null;
  try {
    const parsed = storedDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return {
      text: parsed.data.text,
      mentions: parsed.data.mentions ?? [],
      attachments: parsed.data.attachments ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * What to send for the composer's current text. BB saves typed text a moment
 * after attachments, so mention offsets are trusted only when the stored text
 * is exactly what the composer holds; otherwise the pills go out as the plain
 * text they already are.
 */
export function buildDispatchPayload(
  composerText: string,
  stored: StoredDraft | null,
): DispatchPayload {
  const leading = composerText.length - composerText.trimStart().length;
  const text = composerText.trim();
  const mentions =
    stored !== null && stored.text === composerText
      ? stored.mentions.flatMap((mention) => {
          const start = Math.max(mention.start - leading, 0);
          const end = Math.min(mention.end - leading, text.length);
          return start < end ? [{ ...mention, start, end }] : [];
        })
      : [];
  return { text, mentions, attachments: stored?.attachments ?? [] };
}
