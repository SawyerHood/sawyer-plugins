import { describe, expect, it } from "vitest";
import { buildDispatchPayload, parseStoredDraft } from "./draft";

const resource = { kind: "thread", threadId: "thr_1", label: "Earlier thread" };

describe("parseStoredDraft", () => {
  it("reads BB's stored draft", () => {
    const stored = parseStoredDraft(
      JSON.stringify({
        text: "look at @Earlier thread",
        mentions: [{ start: 8, end: 23, resource }],
        attachments: [{ type: "localImage", path: "attachments/a.png", name: "a.png", sizeBytes: 12 }],
      }),
    );
    expect(stored?.mentions).toHaveLength(1);
    expect(stored?.attachments[0]?.path).toBe("attachments/a.png");
  });

  it("treats missing or malformed storage as no draft", () => {
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft("{not json")).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ attachments: [] }))).toBeNull();
  });
});

describe("buildDispatchPayload", () => {
  it("keeps mention pills when the stored text is current, shifted past trimmed whitespace", () => {
    const text = "  see @Earlier thread  ";
    const payload = buildDispatchPayload(text, {
      text,
      mentions: [{ start: 6, end: 21, resource }],
      attachments: [],
    });
    expect(payload.text).toBe("see @Earlier thread");
    expect(payload.mentions).toEqual([{ start: 4, end: 19, resource }]);
  });

  it("drops mention offsets when the stored text lags the composer, but keeps attachments", () => {
    const attachments = [{ type: "localFile" as const, path: "attachments/log.txt" }];
    const payload = buildDispatchPayload("see @Earlier thread now", {
      text: "see @Earlier thread",
      mentions: [{ start: 4, end: 19, resource }],
      attachments,
    });
    expect(payload.mentions).toEqual([]);
    expect(payload.attachments).toEqual(attachments);
  });

  it("sends plain text when nothing is stored", () => {
    expect(buildDispatchPayload(" hi ", null)).toEqual({ text: "hi", mentions: [], attachments: [] });
  });
});
