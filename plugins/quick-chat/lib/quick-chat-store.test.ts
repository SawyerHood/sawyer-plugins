import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./quick-chat-store";

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
