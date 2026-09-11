import { describe, expect, it } from "vitest";
import {
  anchorFromPosition,
  anchorStyle,
  clampAnchor,
  clampPosition,
  isDoublePress,
  parseStoredAnchor,
} from "./window-position";

const size = { width: 560, height: 680 };
const viewport = { width: 1440, height: 900 };

describe("clampPosition", () => {
  it("leaves a position that fits unchanged", () => {
    expect(clampPosition({ x: 300, y: 100 }, size, viewport)).toEqual({ x: 300, y: 100 });
  });

  it("keeps the window inside the viewport margin", () => {
    expect(clampPosition({ x: -50, y: -20 }, size, viewport)).toEqual({ x: 8, y: 8 });
    expect(clampPosition({ x: 2000, y: 2000 }, size, viewport)).toEqual({ x: 872, y: 212 });
  });

  it("pins to the margin when the window is larger than the viewport", () => {
    expect(clampPosition({ x: 100, y: 100 }, size, { width: 500, height: 600 })).toEqual({
      x: 8,
      y: 8,
    });
  });
});

describe("anchorFromPosition", () => {
  it("anchors to the edges nearest the window's center", () => {
    expect(anchorFromPosition({ x: 100, y: 60 }, size, viewport)).toEqual({
      horizontal: "left",
      vertical: "top",
      x: 100,
      y: 60,
    });
    // Right edge at 1440 - 700 - 560 = 180; bottom edge at 900 - 150 - 680 = 70.
    expect(anchorFromPosition({ x: 700, y: 150 }, size, viewport)).toEqual({
      horizontal: "right",
      vertical: "bottom",
      x: 180,
      y: 70,
    });
  });

  it("locks a window dropped near an edge flush against it", () => {
    expect(anchorFromPosition({ x: 20, y: 8 }, size, viewport)).toMatchObject({
      horizontal: "left",
      vertical: "top",
      x: 16,
      y: 16,
    });
    expect(anchorFromPosition({ x: 872, y: 212 }, size, viewport)).toMatchObject({
      horizontal: "right",
      vertical: "bottom",
      x: 16,
      y: 16,
    });
  });
});

describe("clampAnchor", () => {
  const anchor = { horizontal: "right", vertical: "bottom", x: 400, y: 150 } as const;

  it("keeps offsets that still fit", () => {
    expect(clampAnchor(anchor, size, viewport)).toEqual(anchor);
  });

  it("pulls offsets in when the viewport shrinks", () => {
    expect(clampAnchor(anchor, size, { width: 800, height: 760 })).toEqual({
      ...anchor,
      x: 232,
      y: 72,
    });
  });
});

describe("anchorStyle", () => {
  it("positions from the anchored edges and releases the others", () => {
    expect(anchorStyle({ horizontal: "right", vertical: "top", x: 16, y: 40 })).toEqual({
      left: "auto",
      right: 16,
      top: 40,
      bottom: "auto",
    });
  });
});

describe("parseStoredAnchor", () => {
  it("accepts a well-formed anchor and rejects anything else", () => {
    const stored = { horizontal: "left", vertical: "bottom", x: 16, y: 40 };
    expect(parseStoredAnchor(JSON.stringify(stored))).toEqual(stored);
    expect(parseStoredAnchor(null)).toBeNull();
    expect(parseStoredAnchor("not json")).toBeNull();
    expect(parseStoredAnchor('{"x":12,"y":34}')).toBeNull();
    expect(
      parseStoredAnchor('{"horizontal":"middle","vertical":"top","x":1,"y":2}'),
    ).toBeNull();
  });
});

describe("isDoublePress", () => {
  const first = { x: 100, y: 20, at: 1000 };

  it("matches a quick second press in about the same spot", () => {
    expect(isDoublePress(first, { x: 102, y: 21, at: 1300 })).toBe(true);
  });

  it("rejects a first press, a slow press, or a press that moved", () => {
    expect(isDoublePress(null, first)).toBe(false);
    expect(isDoublePress(first, { x: 100, y: 20, at: 1500 })).toBe(false);
    expect(isDoublePress(first, { x: 140, y: 20, at: 1200 })).toBe(false);
  });
});
