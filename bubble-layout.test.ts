import { describe, expect, it } from "vitest";
import { calculateBubbleLayout } from "./bubble-layout";

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
  it("keeps the bubble inside the left edge and points back at Miku", () => {
    const layout = calculateBubbleLayout({ ...base, companionX: 0 });
    expect(layout.localLeft).toBeGreaterThanOrEqual(10);
    expect(layout.arrowLeft).toBeGreaterThanOrEqual(12);
  });

  it("moves to Miku's left near the right viewport edge", () => {
    const layout = calculateBubbleLayout({ ...base, companionX: 850 });
    const viewportLeft = 850 + layout.localLeft;
    expect(viewportLeft + base.bubbleWidth).toBeLessThanOrEqual(990);
    expect(layout.localLeft).toBeLessThan(0);
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
