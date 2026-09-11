import { describe, expect, it } from "vitest";
import { toChatSummary } from "./server";

const thread = {
  id: "thr_1",
  title: null,
  titleFallback: null,
  updatedAt: 10,
  originPluginId: "quick-chat",
  archivedAt: null,
  deletedAt: null,
};

describe("toChatSummary", () => {
  it("prefers the title, then the fallback, then a placeholder", () => {
    expect(toChatSummary({ ...thread, title: "Soft boil eggs", titleFallback: "x" }).title).toBe(
      "Soft boil eggs",
    );
    expect(toChatSummary({ ...thread, titleFallback: "How long to boil" }).title).toBe(
      "How long to boil",
    );
    expect(toChatSummary(thread)).toEqual({ id: "thr_1", title: "New chat", updatedAt: 10 });
  });
});
