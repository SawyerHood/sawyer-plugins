import { describe, expect, it } from "vitest";
import {
  assertRemovablePath,
  CowPathError,
  deriveRepoDirName,
  resolveTargetPath,
} from "./paths.js";

describe("deriveRepoDirName", () => {
  it.each([
    ["/home/me/code/my-repo", "my-repo"],
    ["/home/me/code/my-repo/", "my-repo"],
    ["/home/me/code/my.repo", "my.repo"],
  ])("derives %s", (input, expected) => {
    expect(deriveRepoDirName(input)).toBe(expected);
  });

  it.each(["/", "", "/home/me/..", "/home/me/.", "/tmp/-flag", "/tmp/my repo"])(
    "rejects %j",
    (input) => {
      expect(() => deriveRepoDirName(input)).toThrowError(CowPathError);
    },
  );
});

describe("resolveTargetPath", () => {
  it("nests the repo name under copies/<pathKey>", () => {
    expect(
      resolveTargetPath({ dataDir: "/data", pathKey: "k1", sourcePath: "/src/repo" }),
    ).toBe("/data/copies/k1/repo");
  });

  it("rejects multi-segment path keys", () => {
    expect(() =>
      resolveTargetPath({ dataDir: "/data", pathKey: "../k", sourcePath: "/src/repo" }),
    ).toThrowError(CowPathError);
  });
});

describe("assertRemovablePath", () => {
  it("accepts a path directly under copies/<pathKey>", () => {
    expect(assertRemovablePath({ dataDir: "/data", path: "/data/copies/k1/repo" })).toBe(
      "/data/copies/k1/repo",
    );
  });

  it.each([
    "/data/copies/k1",
    "/data/copies",
    "/data",
    "/elsewhere/copies/k1/repo",
    "/data/copies/k1/repo/sub",
    "/data/copies/k1/../../../etc",
  ])("refuses %s", (candidate) => {
    expect(() => assertRemovablePath({ dataDir: "/data", path: candidate })).toThrowError(
      CowPathError,
    );
  });
});
