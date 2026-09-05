import { describe, expect, it } from "vitest";
import {
  MIKU_WALKING_STORAGE_KEY,
  decodeMikuWalking,
  readMikuWalking,
  setMikuWalking,
} from "./movement";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("Miku movement preference", () => {
  it("walks by default and understands the persisted stationary state", () => {
    expect(decodeMikuWalking(null)).toBe(true);
    expect(decodeMikuWalking("walking")).toBe(true);
    expect(decodeMikuWalking("stationary")).toBe(false);
  });

  it("persists and reads both movement states", () => {
    const storage = new MemoryStorage();

    setMikuWalking(false, storage);
    expect(storage.getItem(MIKU_WALKING_STORAGE_KEY)).toBe("stationary");
    expect(readMikuWalking(storage)).toBe(false);

    setMikuWalking(true, storage);
    expect(storage.getItem(MIKU_WALKING_STORAGE_KEY)).toBe("walking");
    expect(readMikuWalking(storage)).toBe(true);
  });
});
