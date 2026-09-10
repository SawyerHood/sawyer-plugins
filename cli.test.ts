import { describe, expect, it } from "vitest";
import { parseArgs } from "./cli.js";

describe("parseArgs", () => {
  it("parses a status call", () => {
    expect(parseArgs(["status", "--machine", "box", "/src/repo", "--json"])).toEqual({
      command: "status",
      machine: "box",
      path: "/src/repo",
      json: true,
      error: null,
    });
  });

  it("accepts --host as an alias and options before the command", () => {
    expect(parseArgs(["--host", "h1", "convert", "/p"])).toMatchObject({ command: "convert", machine: "h1", path: "/p" });
  });

  it("reports missing values, unknown options, and extra arguments", () => {
    expect(parseArgs(["status", "--machine"]).error).toMatch(/needs a value/);
    expect(parseArgs(["status", "--bogus"]).error).toMatch(/Unknown option/);
    expect(parseArgs(["status", "/a", "/b"]).error).toMatch(/Unexpected argument/);
  });
});
