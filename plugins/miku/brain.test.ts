import { describe, expect, it } from "vitest";
import {
  formatActivityBatch,
  sanitizeBrainSpeech,
} from "./brain";

describe("Miku brain prompts", () => {
  it("combines a batch of concrete app events", () => {
    const prompt = formatActivityBatch([
      {
        kind: "message sent",
        threadId: "thr_one",
        summary: "The user asked for a palette shortcut.",
      },
      {
        kind: "task completed",
        summary: "MIKU-7 was marked complete.",
      },
    ]);

    expect(prompt).toContain("APP ACTIVITY BATCH (2 events)");
    expect(prompt).toContain("palette shortcut");
    expect(prompt).toContain("MIKU-7");
  });

  it("turns model output into one bounded speech-bubble line", () => {
    expect(sanitizeBrainSpeech("Miku: **Nice work!**\nExtra text")).toBe(
      "Nice work!",
    );
    expect(sanitizeBrainSpeech("[silent]")).toBeNull();
    expect(sanitizeBrainSpeech("[ready]")).toBeNull();
    expect(sanitizeBrainSpeech("x".repeat(300))).toHaveLength(180);
  });
});
