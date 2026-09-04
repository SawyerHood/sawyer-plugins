import { describe, expect, it } from "vitest";
import {
  MIKU_VISIBILITY_STORAGE_KEY,
  decodeMikuVisibility,
  readMikuVisibility,
  setMikuVisibility,
} from "./visibility";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("Miku visibility", () => {
  it("is visible by default and understands the persisted hidden state", () => {
    expect(decodeMikuVisibility(null)).toBe(true);
    expect(decodeMikuVisibility("visible")).toBe(true);
    expect(decodeMikuVisibility("hidden")).toBe(false);
  });

  it("persists and reads both visibility states", () => {
    const storage = new MemoryStorage();

    setMikuVisibility(false, storage);
    expect(storage.getItem(MIKU_VISIBILITY_STORAGE_KEY)).toBe("hidden");
    expect(readMikuVisibility(storage)).toBe(false);

    setMikuVisibility(true, storage);
    expect(storage.getItem(MIKU_VISIBILITY_STORAGE_KEY)).toBe("visible");
    expect(readMikuVisibility(storage)).toBe(true);
  });
});
