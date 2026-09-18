import { describe, expect, it } from "vitest";
import { parseCli } from "./cli.js";
import { rpcContract } from "./contracts.js";

const id = "1a12a3f1-12de-4fbb-a011-df0905678757";
describe("CLI boundaries", () => {
  it("opens local headless sessions with no cursor and instant input by default", () => {
    const parsed = parseCli(["open", "--machine", "host"], "thread");
    expect(parsed.input).toEqual({
      threadId: "thread",
      selection: { backend: "local", hostId: "host" },
      inputMode: "instant",
      cursor: false,
      ignoreHttpsErrors: false,
    });
    expect(() => parseCli(["open"], "thread")).toThrow("--machine");
  });
  it("selects the desktop backend only with an explicit instance", () => {
    expect(
      parseCli(
        ["open", "--machine", "host", "--desktop", "instance", "--tab", "tab"],
        "thread",
      ).input.selection,
    ).toEqual({
      backend: "desktop",
      hostId: "host",
      instanceId: "instance",
      tabId: "tab",
    });
    expect(() =>
      parseCli(["open", "--machine", "host", "--tab", "tab"], "thread"),
    ).toThrow("--desktop");
  });
  it("turns on the cursor with human movement only when asked", () => {
    expect(
      parseCli(["open", "--machine", "host", "--cursor"], "thread").input,
    ).toMatchObject({ inputMode: "human", cursor: true });
    // An explicit input mode wins in both directions.
    expect(
      parseCli(
        ["open", "--machine", "host", "--cursor", "--input-mode", "instant"],
        "thread",
      ).input,
    ).toMatchObject({ inputMode: "instant", cursor: true });
    expect(
      parseCli(["open", "--machine", "host", "--input-mode", "human"], "thread")
        .input,
    ).toMatchObject({ inputMode: "human", cursor: false });
    expect(() =>
      parseCli(["open", "--machine", "host", "--no-cursor"], "thread"),
    ).toThrow("Unknown");
  });
  it("parses launch options on open", () => {
    const parsed = parseCli(
      [
        "open",
        "--machine",
        "host",
        "--input-mode",
        "smooth",
        "--ignore-https-errors",
      ],
      "thread",
    );
    expect(parsed.input).toMatchObject({
      inputMode: "smooth",
      cursor: false,
      ignoreHttpsErrors: true,
    });
    expect(() =>
      parseCli(["open", "--machine", "host", "--input-mode", "fast"], "thread"),
    ).toThrow("human, smooth, or instant");
  });
  it("rejects cross-thread and ignored flags", () => {
    expect(() => parseCli(["list", "--thread", "other"], "thread")).toThrow(
      "another thread",
    );
    expect(() => parseCli(["list", "--cursor"], "thread")).toThrow("Unknown");
    expect(() => parseCli(["list", "--json", "--json"], "thread")).toThrow(
      "duplicate",
    );
    expect(() => parseCli(["list"])).toThrow("--thread");
  });
  it("passes everything after -- to agent-browser untouched", () => {
    const parsed = parseCli(
      ["run", id, "--timeout-ms", "90000", "--", "fill", "@e3", "--json"],
      "thread",
    );
    expect(parsed.json).toBe(false);
    expect(parsed.input).toEqual({
      threadId: "thread",
      sessionId: id,
      args: ["fill", "@e3", "--json"],
      timeoutMs: 90_000,
    });
  });
  it("starts the passthrough at the first token that is not its own flag", () => {
    const parsed = parseCli(["run", id, "--json", "snapshot", "-i"], "thread");
    expect(parsed.json).toBe(true);
    expect(parsed.input.args).toEqual(["snapshot", "-i"]);
    expect(parsed.input.timeoutMs).toBe(60_000);
  });
  it("guards the passthrough and validates timeout at the common boundary", () => {
    expect(() => parseCli(["run", id], "thread")).toThrow(
      "agent-browser command",
    );
    expect(() => parseCli(["run", id, "--", "close"], "thread")).toThrow(
      "bb agent-browser close",
    );
    expect(() =>
      parseCli(["run", id, "--", "snapshot", "--session", "x"], "thread"),
    ).toThrow("--session");
    const parsed = parseCli(
      ["run", id, "--timeout-ms", "1", "--", "snapshot"],
      "thread",
    );
    expect(() => rpcContract.run.input.parse(parsed.input)).toThrow();
  });
  it("parses screenshot options", () => {
    expect(
      parseCli(["screenshot", id, "--full", "--annotate"], "thread").input,
    ).toEqual({ threadId: "thread", sessionId: id, full: true, annotate: true });
    expect(() => parseCli(["screenshot", id, "--page", "x"], "thread")).toThrow(
      "Unknown",
    );
  });
  it("parses preview sequence cursors and rejects invalid ones at the common boundary", () => {
    expect(parseCli(["preview", id], "thread").input).toEqual({
      threadId: "thread",
      sessionId: id,
      afterSequence: 0,
    });
    const parsed = parseCli(["preview", id, "--after", "12"], "thread");
    expect(rpcContract.preview.input.parse(parsed.input).afterSequence).toBe(
      12,
    );
    expect(() =>
      rpcContract.preview.input.parse(
        parseCli(["preview", id, "--after", "soon"], "thread").input,
      ),
    ).toThrow();
  });
  it("requires exactly one session ID for session commands", () => {
    for (const method of ["recording", "stop", "close"]) {
      expect(parseCli([method, id], "thread").input.sessionId).toBe(id);
      expect(() => parseCli([method], "thread")).toThrow("one session ID");
    }
  });
});
