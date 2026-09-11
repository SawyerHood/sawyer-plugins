import { describe, expect, it } from "vitest";
import { formatRelativeTime, isQuickChatShortcut } from "./quick-chat-store";

const key = (overrides: Partial<KeyboardEvent>) => ({
  code: "KeyK",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: true,
  ...overrides,
});

describe("isQuickChatShortcut", () => {
  it("uses Cmd on macOS and Ctrl elsewhere", () => {
    expect(isQuickChatShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isQuickChatShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isQuickChatShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isQuickChatShortcut(key({ metaKey: true }), false)).toBe(false);
  });

  it("requires Shift, rejects Alt, and matches the physical K key", () => {
    expect(isQuickChatShortcut(key({ ctrlKey: true, shiftKey: false }), false)).toBe(false);
    expect(isQuickChatShortcut(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isQuickChatShortcut(key({ ctrlKey: true, code: "KeyJ" }), false)).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 8, 11, 12);
  const ago = (ms: number) => formatRelativeTime(now - ms, now);

  it("formats recent activity compactly", () => {
    expect(ago(20_000)).toBe("Now");
    expect(ago(5 * 60_000)).toBe("5m");
    expect(ago(3 * 3_600_000)).toBe("3h");
    expect(ago(30 * 3_600_000)).toBe("Yesterday");
    expect(ago(3 * 86_400_000)).toBe("3d");
    expect(ago(15 * 86_400_000)).toBe("2w");
  });
});
