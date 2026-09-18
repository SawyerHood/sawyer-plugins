import { describe, expect, it } from "vitest";
import { execute } from "./process.js";

const node = process.execPath;
const options = (signal = new AbortController().signal) => ({
  env: { PATH: process.env.PATH, MARKER: "from-session" },
  cwd: process.cwd(),
  signal,
});

describe("agent-browser CLI invocations", () => {
  it("returns stdout, stderr, and the exit code without throwing", async () => {
    const result = await execute(
      node,
      [
        "-e",
        'process.stdout.write("out:" + process.env.MARKER); process.stderr.write("err"); process.exit(3)',
      ],
      options(),
    );
    expect(result).toEqual({ code: 3, stdout: "out:from-session", stderr: "err" });
  });
  it("passes only the session environment", async () => {
    process.env.AGENT_BROWSER_HEADED = "1";
    try {
      const result = await execute(
        node,
        ["-e", 'process.stdout.write(String(process.env.AGENT_BROWSER_HEADED))'],
        options(),
      );
      expect(result.stdout).toBe("undefined");
    } finally {
      delete process.env.AGENT_BROWSER_HEADED;
    }
  });
  it("kills the client when the signal aborts", async () => {
    const abort = new AbortController();
    const pending = execute(
      node,
      ["-e", "setInterval(() => {}, 1000)"],
      options(abort.signal),
    );
    setTimeout(() => abort.abort(), 50);
    await expect(pending).rejects.toThrow("cancelled or timed out");
    await expect(
      execute(node, ["-e", "1"], options(AbortSignal.abort())),
    ).rejects.toThrow();
  });
  it("rejects output beyond 512 KB instead of buffering it", async () => {
    await expect(
      execute(
        node,
        ["-e", 'process.stdout.write("x".repeat(600_000)); setInterval(() => {}, 1000)'],
        options(),
      ),
    ).rejects.toThrow("512 KB");
  });
});
