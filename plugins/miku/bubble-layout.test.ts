import { describe, expect, it } from "vitest";
import {
  calculateBubbleAnchorY,
  calculateBubbleLayout,
} from "./bubble-layout";

const base = {
  companionY: 120,
  companionWidth: 138,
  bubbleWidth: 230,
  bubbleHeight: 58,
  viewportWidth: 1_000,
  viewportMargin: 10,
  anchorY: 24,
};

describe("Miku bubble layout", () => {
  it("uses one stable anchor across differently cropped walk and idle frames", () => {
    const anchors = [59, 64, 61, 63, 68].map((frameHeight, index) =>
      calculateBubbleAnchorY({
        frameHeight,
        canvasHeight: 102,
        renderedHeight: 153,
        gap: 8,
        mode: index < 3 ? "walking" : "idle",
      }),
    );

    expect(new Set(anchors).size).toBe(1);
    expect(anchors[0]).toBe(49);
  });

  it("still clears the current frame during tall reactions", () => {
    const regular = calculateBubbleAnchorY({
      frameHeight: 64,
      canvasHeight: 102,
      renderedHeight: 153,
      gap: 8,
      mode: "reacting",
    });
    const tall = calculateBubbleAnchorY({
      frameHeight: 97,
      canvasHeight: 102,
      renderedHeight: 153,
      gap: 8,
      mode: "reacting",
    });

    expect(tall).toBeLessThan(regular);
  });

  it("keeps the bubble inside the left edge", () => {
    const layout = calculateBubbleLayout({ ...base, companionX: 0 });
    expect(layout.localLeft).toBeGreaterThanOrEqual(10);
  });

  it("keeps the bubble inside the right viewport edge", () => {
    const layout = calculateBubbleLayout({ ...base, companionX: 850 });
    const viewportLeft = 850 + layout.localLeft;
    expect(viewportLeft + base.bubbleWidth).toBeLessThanOrEqual(990);
    expect(layout.localLeft).toBeLessThan(0);
  });

  it("centers the bubble over Miku when there is enough room", () => {
    const companionX = 400;
    const layout = calculateBubbleLayout({ ...base, companionX });
    const companionCenter = companionX + base.companionWidth / 2;
    const bubbleCenter = companionX + layout.localLeft + base.bubbleWidth / 2;

    expect(bubbleCenter).toBe(companionCenter);
  });

  it("keeps tall wrapped text above Miku without crossing the top edge", () => {
    const layout = calculateBubbleLayout({
      ...base,
      companionX: 400,
      companionY: 35,
      bubbleHeight: 82,
    });
    expect(35 + layout.localTop).toBeGreaterThanOrEqual(10);
    expect(layout.localTop).toBe(-25);
  });
});
