import { describe, expect, it } from "vitest";
import { checkArgs } from "./guard.js";

describe("agent-browser command guard", () => {
  it("passes ordinary commands and their flags through", () => {
    for (const args of [
      ["snapshot", "-i"],
      ["click", "@e2", "--human"],
      ["fill", "@e3", "hello --world"],
      ["open", "https://example.com"],
      ["screenshot", "--annotate", "--full"],
      ["get", "cdp-url"],
      ["mouse", "move", "600", "400", "--human", "--seed", "42"],
      ["skills", "get", "core", "--full"],
      ["snapshot", "--max-output", "5000", "--json"],
      ["batch", "--bail", "open https://example.com", "snapshot -i"],
    ])
      expect(() => checkArgs(args), args.join(" ")).not.toThrow();
  });
  it("requires the command first so it cannot hide behind a flag value", () => {
    expect(() => checkArgs(["--json", "snapshot"])).toThrow("command first");
    expect(() => checkArgs(["--max-output", "close"])).toThrow("command first");
    expect(() => checkArgs([""])).toThrow("command first");
  });
  it("keeps the session's lifecycle, attachment, and recording with BB", () => {
    expect(() => checkArgs(["close"])).toThrow("bb agent-browser close");
    expect(() => checkArgs(["quit"])).toThrow("lifecycle");
    expect(() => checkArgs(["connect", "9222"])).toThrow("attached");
    expect(() => checkArgs(["record", "stop"])).toThrow(
      "bb agent-browser recording",
    );
    expect(() => checkArgs(["stream", "disable"])).toThrow("live preview");
    expect(() => checkArgs(["install"])).toThrow("host");
    expect(() => checkArgs(["dashboard", "start"])).toThrow("host");
  });
  it("rejects flags that re-target or relaunch the browser, in either form", () => {
    expect(() => checkArgs(["snapshot", "--session", "other"])).toThrow(
      "--session",
    );
    expect(() => checkArgs(["snapshot", "--session=other"])).toThrow(
      "--session",
    );
    expect(() => checkArgs(["open", "https://x.test", "--cdp", "9222"])).toThrow(
      "--cdp",
    );
    expect(() => checkArgs(["open", "https://x.test", "-p", "kernel"])).toThrow(
      "-p",
    );
    expect(() => checkArgs(["open", "https://x.test", "--headed"])).toThrow(
      "relaunch",
    );
    expect(() =>
      checkArgs(["open", "https://x.test", "--user-agent", "x"]),
    ).toThrow("relaunch");
  });
  it("applies the same rules inside batch entries", () => {
    expect(() => checkArgs(["batch", "get url", "close"])).toThrow(
      "inside batch",
    );
    expect(() => checkArgs(["batch", "snapshot --profile Default"])).toThrow(
      "--profile",
    );
    expect(() => checkArgs(["batch", "  record   start x.webm"])).toThrow(
      "inside batch",
    );
  });
});
