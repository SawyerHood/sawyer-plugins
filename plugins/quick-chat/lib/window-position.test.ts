import { describe, expect, it } from "vitest";
import { clampPosition, isDoublePress, parseStoredPosition } from "./window-position";

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

describe("parseStoredPosition", () => {
  it("accepts finite coordinates and rejects anything else", () => {
    expect(parseStoredPosition('{"x":12,"y":34}')).toEqual({ x: 12, y: 34 });
    expect(parseStoredPosition(null)).toBeNull();
    expect(parseStoredPosition("not json")).toBeNull();
    expect(parseStoredPosition('{"x":"12","y":34}')).toBeNull();
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
