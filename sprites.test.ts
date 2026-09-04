import { describe, expect, it } from "vitest";
import { ANIMATION_CLIPS, CANVAS_HEIGHT, CANVAS_WIDTH } from "./sprites";

describe("sprite catalogue", () => {
  it("keeps every production frame inside the source sheet and render canvas", () => {
    for (const [name, clip] of Object.entries(ANIMATION_CLIPS)) {
      expect(clip.steps.length, name).toBeGreaterThan(0);
      for (const { frame } of clip.steps) {
        expect(frame.x, name).toBeGreaterThanOrEqual(0);
        expect(frame.y, name).toBeGreaterThanOrEqual(0);
        expect(frame.x + frame.width, name).toBeLessThanOrEqual(1180);
        expect(frame.y + frame.height, name).toBeLessThanOrEqual(497);
        expect(frame.width, name).toBeLessThanOrEqual(CANVAS_WIDTH);
        expect(frame.height, name).toBeLessThanOrEqual(CANVAS_HEIGHT);
      }
    }
  });
});
