import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commandText,
  createRuntime,
  jpegSize,
  redact,
  runtimeEnvironment,
} from "./runtime.js";

// A stand-in for the agent-browser CLI: the first command starts a detached
// "daemon" and writes its PID file, like the real client does. Files next to
// the script switch on failure modes.
const fake = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const here = __dirname;
const args = process.argv.slice(2);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("AGENT_BROWSER_")));
fs.appendFileSync(path.join(here, "calls.jsonl"), JSON.stringify({ args, env, cwd: process.cwd() }) + "\\n");
const flag = (name) => fs.existsSync(path.join(here, name));
const pidFile = path.join(process.env.AGENT_BROWSER_SOCKET_DIR, process.env.AGENT_BROWSER_SESSION + ".pid");
const command = args.join(" ");
if (command === "close") {
  if (flag("ignore-close")) process.exit(0);
  try { process.kill(Number(fs.readFileSync(pidFile, "utf8")), "SIGKILL"); } catch {}
  fs.rmSync(pidFile, { force: true });
  process.exit(0);
}
if (!fs.existsSync(pidFile)) {
  if (flag("fail-start")) { process.stderr.write("\\u2717 Chrome exited early\\n"); process.exit(1); }
  const daemon = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  daemon.unref();
  fs.writeFileSync(pidFile, String(daemon.pid));
}
if (command.startsWith("record start")) {
  if (flag("fail-record")) { process.stderr.write("\\u2717 ffmpeg not found on PATH\\nInstall it first\\n"); process.exit(1); }
  if (flag("fail-bridge")) { process.stderr.write("\\u2717 CDP error (Target.getTargetInfo): CDP method is not supported for scoped page sessions\\n"); process.exit(1); }
  fs.writeFileSync(args[2], "take");
} else if (command.startsWith("record restart")) {
  if (flag("fail-restart")) { process.stdout.write(JSON.stringify({ success: false, error: "No recording in progress" })); process.exit(1); }
  const next = args[2];
  const previous = next.replace(/take-(\\d+)/, (_m, n) => "take-" + (Number(n) - 1));
  fs.writeFileSync(next, "take");
  process.stdout.write(JSON.stringify({ success: true, data: { path: next, previousPath: previous } }));
} else if (command === "get cdp-url") {
  process.stdout.write(flag("remote-cdp") ? "ws://10.0.0.5:9222/devtools/browser/abc\\n" : "ws://127.0.0.1:1/devtools/browser/abc\\n");
} else if (args[0] === "screenshot") {
  const body = flag("big-screenshot") ? Buffer.alloc(4_000_100) : Buffer.alloc(0);
  fs.writeFileSync(args[1], Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0x00, 0x00, 0x00]), body]));
  process.stdout.write("\\u2713 Screenshot saved to " + args[1] + "\\n");
} else if (command === "wait forever") {
  setInterval(() => {}, 1000);
} else if (command === "click @e999") {
  process.stderr.write("\\u2717 Unknown ref: e999\\n");
  process.exit(1);
} else if (command === "get url") {
  process.stdout.write((process.env.AGENT_BROWSER_CDP || "about:blank") + "\\n");
} else {
  process.stdout.write("ran " + command + "\\n");
}
`;

let root: string;
let binary: string;
const signal = new AbortController().signal;

async function calls(): Promise<
  { args: string[]; env: Record<string, string>; cwd: string }[]
> {
  const text = await readFile(join(root, "bin", "calls.jsonl"), "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function exited(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (alive(pid) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  return !alive(pid);
}

async function daemonPid(): Promise<number> {
  const env = (await calls())[0]!.env;
  return Number(
    await readFile(join(env.AGENT_BROWSER_SOCKET_DIR!, "bb.pid"), "utf8"),
  );
}

function open(overrides: Partial<Parameters<typeof createRuntime>[0]> = {}) {
  return createRuntime({
    runtime: { binary, version: "0.38.1", chrome: true },
    dataDir: join(root, "data"),
    tempDir: join(root, "tmp"),
    inputMode: "human",
    cursor: true,
    ignoreHttpsErrors: false,
    idleTimeoutMs: 300_000,
    signal,
    ...overrides,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ab-runtime-"));
  await mkdir(join(root, "bin"));
  binary = join(root, "bin", "agent-browser");
  await writeFile(binary, fake);
  await chmod(binary, 0o755);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("runtime helpers", () => {
  it("builds an isolated environment that never inherits agent-browser settings", () => {
    process.env.AGENT_BROWSER_HEADED = "1";
    process.env.AGENT_BROWSER_PROFILE = "Default";
    try {
      const env = runtimeEnvironment({
        home: "/s/home",
        socketDir: "/tmp/sock",
        idleTimeoutMs: 300_000,
        chrome: null,
        connectionUrl: undefined,
        ignoreHttpsErrors: false,
      });
      expect(env).toMatchObject({
        AGENT_BROWSER_SESSION: "bb",
        AGENT_BROWSER_SOCKET_DIR: "/tmp/sock",
        AGENT_BROWSER_CONFIG: "/s/home/config.json",
        AGENT_BROWSER_IDLE_TIMEOUT_MS: "360000",
        AGENT_BROWSER_SCREENSHOT_DIR: "/s/home/captures",
        AGENT_BROWSER_SCREENSHOT_FORMAT: "jpeg",
        AGENT_BROWSER_DOWNLOAD_PATH: "/s/home/files",
      });
      expect(env.PATH).toBe(process.env.PATH);
      for (const key of [
        "AGENT_BROWSER_HEADED",
        "AGENT_BROWSER_PROFILE",
        "AGENT_BROWSER_CDP",
        "AGENT_BROWSER_EXECUTABLE_PATH",
        "AGENT_BROWSER_IGNORE_HTTPS_ERRORS",
      ])
        expect(env[key]).toBeUndefined();
    } finally {
      delete process.env.AGENT_BROWSER_HEADED;
      delete process.env.AGENT_BROWSER_PROFILE;
    }
  });
  it("adds only the options a session asked for", () => {
    const env = runtimeEnvironment({
      home: "/s/home",
      socketDir: "/tmp/sock",
      idleTimeoutMs: 1_000,
      chrome: "/opt/chrome",
      connectionUrl: "ws://127.0.0.1:9/cdp/token",
      ignoreHttpsErrors: true,
    });
    expect(env.AGENT_BROWSER_EXECUTABLE_PATH).toBe("/opt/chrome");
    expect(env.AGENT_BROWSER_CDP).toBe("ws://127.0.0.1:9/cdp/token");
    expect(env.AGENT_BROWSER_IGNORE_HTTPS_ERRORS).toBe("1");
  });
  it("removes desktop connection credentials from command output", () => {
    const token = "a".repeat(64);
    const url = `ws://127.0.0.1:4100/cdp/${token}?key=s3cret-value`;
    const text = redact(`at ${url} then /cdp/${token} and ${token} s3cret-value`, url);
    expect(text).not.toContain(token);
    expect(text).not.toContain("s3cret-value");
    expect(redact("ws://127.0.0.1:1/devtools", undefined)).toBe(
      "ws://127.0.0.1:1/devtools",
    );
  });
  it("joins stdout and stderr and bounds the text", () => {
    expect(
      commandText({ code: 1, stdout: "partial\n", stderr: "✗ failed\n" }, undefined),
    ).toBe("partial\n✗ failed");
    const long = commandText(
      { code: 0, stdout: "x".repeat(200_000), stderr: "" },
      undefined,
    );
    expect(long.length).toBeLessThanOrEqual(160_000);
    expect(long).toContain("[output truncated by BB]");
  });
  it("reads JPEG dimensions past leading segments", () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x11,
      0x08, 0x02, 0x41, 0x05, 0x00, 0x03, 0x00, 0x00, 0x00,
    ]);
    expect(jpegSize(jpeg)).toEqual({ width: 1280, height: 577 });
    expect(jpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegSize(jpeg.slice(0, 10))).toBeNull();
  });
});

describe("agent-browser sessions", () => {
  it("opens a local session with human input, a 16:9 page, and a cursor recording", async () => {
    const session = await open();
    try {
      expect(session.cursor).toEqual({ enabled: true, detail: null });
      expect(session.preview).not.toBeNull();
      const made = await calls();
      expect(made.map((call) => call.args.slice(0, 2).join(" "))).toEqual([
        "open about:blank",
        "set viewport",
        "record start",
        "get cdp-url",
      ]);
      expect(made[0]!.args).toEqual([
        "open",
        "about:blank",
        "--input-mode",
        "human",
      ]);
      expect(made[2]!.args.slice(3)).toEqual(["--cursor", "--fps", "15"]);
      expect(made[2]!.args[2]).toMatch(/recordings\/take-1\.webm$/);
      expect(made[0]!.env.AGENT_BROWSER_SESSION).toBe("bb");
      expect(made[0]!.env.AGENT_BROWSER_CDP).toBeUndefined();
      expect(made[0]!.cwd).toMatch(/files$/);
      expect(
        await readFile(made[0]!.env.AGENT_BROWSER_CONFIG!, "utf8"),
      ).toBe("{}\n");
      // Unix socket paths are short-limited; the session directory may not be.
      expect(
        join(made[0]!.env.AGENT_BROWSER_SOCKET_DIR!, "bb.sock").length,
      ).toBeLessThan(90);
    } finally {
      await session.close();
    }
  });
  it("uses a Chrome linked in plugin data", async () => {
    await mkdir(join(root, "data", "runtime"), { recursive: true });
    await writeFile(join(root, "data", "runtime", "chrome"), "#!/bin/sh\n", {
      mode: 0o755,
    });
    const session = await open();
    try {
      expect((await calls())[0]!.env.AGENT_BROWSER_EXECUTABLE_PATH).toBe(
        join(root, "data", "runtime", "chrome"),
      );
    } finally {
      await session.close();
    }
  });
  it("opens without a cursor when the recording cannot start, and says why", async () => {
    await writeFile(join(root, "bin", "fail-record"), "");
    const session = await open();
    try {
      expect(session.cursor).toEqual({
        enabled: false,
        detail: "ffmpeg not found on PATH",
      });
      expect((await session.run(["get", "title"], 5_000, signal)).exitCode).toBe(0);
      const take = await session.recording(signal);
      expect(take.recording).toBeNull();
      expect(take.detail).toContain("ffmpeg not found on PATH");
    } finally {
      await session.close();
    }
  });
  it("retries the cursor after a page loads, at most twice, and never after other commands", async () => {
    await writeFile(join(root, "bin", "fail-record"), "");
    const session = await open();
    const starts = async () =>
      (await calls()).filter((call) => call.args[1] === "start").length;
    try {
      expect(session.cursor.enabled).toBe(false);
      await session.run(["snapshot", "-i"], 5_000, signal);
      await session.run(["click", "@e999"], 5_000, signal);
      expect(await starts()).toBe(1);
      await session.run(["open", "https://example.com"], 5_000, signal);
      expect(await starts()).toBe(2);
      expect(session.cursor.enabled).toBe(false);
      await rm(join(root, "bin", "fail-record"));
      await session.run(["goto", "https://example.com/next"], 5_000, signal);
      expect(await starts()).toBe(3);
      expect(session.cursor).toEqual({ enabled: true, detail: null });
      await session.run(["open", "https://example.com/again"], 5_000, signal);
      expect(await starts()).toBe(3);
      expect((await session.recording(signal)).recording?.path).toMatch(
        /take-1\.webm$/,
      );
    } finally {
      await session.close();
    }
  });
  it("stops retrying the cursor after two failed pages", async () => {
    await writeFile(join(root, "bin", "fail-record"), "");
    const session = await open();
    try {
      for (const page of ["a", "b", "c", "d"])
        await session.run(["open", `https://example.com/${page}`], 5_000, signal);
      expect(
        (await calls()).filter((call) => call.args[1] === "start"),
      ).toHaveLength(3);
      expect(session.cursor.detail).toBe("ffmpeg not found on PATH");
    } finally {
      await session.close();
    }
  });
  it("skips the recording when the cursor is turned off", async () => {
    const session = await open({ cursor: false, inputMode: "instant" });
    try {
      expect(session.cursor.enabled).toBe(false);
      const made = await calls();
      expect(made.some((call) => call.args[0] === "record")).toBe(false);
      expect(made[0]!.args.at(-1)).toBe("instant");
      await session.run(["open", "https://example.com"], 5_000, signal);
      expect(
        (await calls()).some((call) => call.args[0] === "record"),
      ).toBe(false);
    } finally {
      await session.close();
    }
  });
  it("attaches desktop sessions through the environment, without a preview", async () => {
    const token = "b".repeat(64);
    const connectionUrl = `ws://127.0.0.1:4100/cdp/${token}`;
    const session = await open({ connectionUrl });
    try {
      expect(session.preview).toBeNull();
      const made = await calls();
      // The blank tab cannot be recorded yet; the first page starts the cursor.
      expect(made.map((call) => call.args.slice(0, 2).join(" "))).toEqual([
        "get url",
      ]);
      expect(session.cursor).toEqual({
        enabled: false,
        detail: "The cursor starts once the desktop tab has loaded a page",
      });
      expect(made[0]!.args).toEqual(["get", "url", "--input-mode", "human"]);
      expect(made[0]!.env.AGENT_BROWSER_CDP).toBe(connectionUrl);
      expect(made.flatMap((call) => call.args).join(" ")).not.toContain(token);
      const output = await session.run(["get", "url"], 5_000, signal);
      expect(output.text).toBe("[browser connection]");
      await session.run(["open", "https://example.com"], 5_000, signal);
      expect(session.cursor).toEqual({ enabled: true, detail: null });
    } finally {
      await session.close();
    }
  });
  it("explains a desktop bridge that blocks the recorder", async () => {
    await writeFile(join(root, "bin", "fail-bridge"), "");
    const session = await open({
      connectionUrl: `ws://127.0.0.1:4100/cdp/${"c".repeat(64)}`,
    });
    try {
      await session.run(["open", "https://example.com"], 5_000, signal);
      expect(session.cursor.enabled).toBe(false);
      expect(session.cursor.detail).toMatch(
        /^BB's desktop browser bridge does not yet allow .*Target\.getTargetInfo/,
      );
    } finally {
      await session.close();
    }
  });
  it("rejects desktop connections that are not loopback WebSockets", async () => {
    await expect(
      open({ connectionUrl: "ws://10.0.0.5:9222/cdp/token" }),
    ).rejects.toThrow("loopback");
    await expect(
      open({ connectionUrl: "http://127.0.0.1:9222/" }),
    ).rejects.toThrow("loopback");
    expect(existsSync(join(root, "bin", "calls.jsonl"))).toBe(false);
  });
  it("refuses a local CDP endpoint that is not loopback", async () => {
    await writeFile(join(root, "bin", "remote-cdp"), "");
    await expect(open()).rejects.toThrow("unexpected CDP endpoint");
    expect(await readdir(join(root, "tmp"))).toEqual([]);
  });
  it("reports a failed start with agent-browser's message and cleans up", async () => {
    await writeFile(join(root, "bin", "fail-start"), "");
    await expect(open()).rejects.toThrow("Chrome exited early");
    expect(await readdir(join(root, "tmp"))).toEqual([]);
  });
  it("returns command failures as output and keeps the session", async () => {
    const session = await open();
    try {
      const failed = await session.run(["click", "@e999"], 5_000, signal);
      expect(failed).toEqual({
        text: "✗ Unknown ref: e999",
        images: [],
        exitCode: 1,
      });
      const next = await session.run(["snapshot", "-i"], 5_000, signal);
      expect(next).toEqual({ text: "ran snapshot -i", images: [], exitCode: 0 });
    } finally {
      await session.close();
    }
  });
  it("answers a timeout with exit 124 and keeps the session", async () => {
    const session = await open();
    try {
      const slow = await session.run(["wait", "forever"], 1_000, signal);
      expect(slow.exitCode).toBe(124);
      expect(slow.text).toContain("1000 ms");
      expect((await session.run(["get", "title"], 5_000, signal)).exitCode).toBe(0);
    } finally {
      await session.close();
    }
  });
  it("rejects a cancelled run without ending the session", async () => {
    const session = await open();
    try {
      const abort = new AbortController();
      const pending = session.run(["wait", "forever"], 30_000, abort.signal);
      setTimeout(() => abort.abort(), 100);
      await expect(pending).rejects.toThrow("cancelled");
      expect((await session.run(["get", "title"], 5_000, signal)).exitCode).toBe(0);
    } finally {
      await session.close();
    }
  });
  it("serializes runs in call order", async () => {
    const session = await open();
    try {
      await Promise.all(
        ["one", "two", "three"].map((name) =>
          session.run(["get", name], 5_000, signal),
        ),
      );
      const order = (await calls())
        .filter((call) => ["one", "two", "three"].includes(call.args[1]!))
        .map((call) => call.args[1]);
      expect(order).toEqual(["one", "two", "three"]);
    } finally {
      await session.close();
    }
  });
  it("captures a JPEG inside session storage with its pixel size", async () => {
    const session = await open();
    try {
      const shot = await session.screenshot(
        { full: true, annotate: true },
        signal,
      );
      expect(shot.exitCode).toBe(0);
      expect(shot.images).toHaveLength(1);
      expect(shot.images[0]).toMatchObject({
        mimeType: "image/jpeg",
        width: 1280,
        height: 720,
      });
      expect(shot.images[0]!.path).toMatch(/captures\/[0-9a-f-]+\.jpg$/);
      const call = (await calls()).find((made) => made.args[0] === "screenshot");
      expect(call!.args.slice(2)).toEqual(["--full", "--annotate"]);
    } finally {
      await session.close();
    }
  });
  it("turns an oversized screenshot into a command failure", async () => {
    await writeFile(join(root, "bin", "big-screenshot"), "");
    const session = await open();
    try {
      const shot = await session.screenshot(
        { full: true, annotate: false },
        signal,
      );
      expect(shot).toMatchObject({ images: [], exitCode: 1 });
      expect(shot.text).toContain("4 MB");
    } finally {
      await session.close();
    }
  });
  it("hands back finished takes while recording continues", async () => {
    const session = await open();
    try {
      const first = await session.recording(signal);
      expect(first.recording?.path).toMatch(/recordings\/take-1\.webm$/);
      expect(first.recording).toMatchObject({ mimeType: "video/webm", bytes: 4 });
      const second = await session.recording(signal);
      expect(second.recording?.path).toMatch(/recordings\/take-2\.webm$/);
      const restarts = (await calls()).filter(
        (call) => call.args[1] === "restart",
      );
      expect(restarts.map((call) => call.args[2]!.match(/take-\d+/)![0])).toEqual([
        "take-2",
        "take-3",
      ]);
      expect(restarts[0]!.args.slice(3)).toEqual([
        "--cursor",
        "--fps",
        "15",
        "--json",
      ]);
    } finally {
      await session.close();
    }
  });
  it("reports a failed take without ending the session", async () => {
    const session = await open();
    try {
      await writeFile(join(root, "bin", "fail-restart"), "");
      const take = await session.recording(signal);
      expect(take.recording).toBeNull();
      expect(take.detail).toContain("could not finish the recording take");
      expect((await session.run(["get", "title"], 5_000, signal)).exitCode).toBe(0);
    } finally {
      await session.close();
    }
  });
  it("closes the daemon and removes every session directory", async () => {
    const session = await open();
    const pid = await daemonPid();
    const socketDir = (await calls())[0]!.env.AGENT_BROWSER_SOCKET_DIR!;
    expect(alive(pid)).toBe(true);
    await session.close();
    await session.close();
    expect(await exited(pid)).toBe(true);
    expect(existsSync(socketDir)).toBe(false);
    expect(await readdir(join(root, "tmp"))).toEqual([]);
    expect((await calls()).filter((call) => call.args[0] === "close")).toHaveLength(1);
    await expect(session.run(["get", "url"], 5_000, signal)).rejects.toThrow(
      "open a new session",
    );
  });
  it("signals a daemon that ignores close", async () => {
    await writeFile(join(root, "bin", "ignore-close"), "");
    const session = await open();
    const pid = await daemonPid();
    await session.close();
    expect(await exited(pid)).toBe(true);
  });
  it("ends the session instead of letting the CLI start a fresh daemon", async () => {
    const session = await open();
    const pid = await daemonPid();
    const socketDir = (await calls())[0]!.env.AGENT_BROWSER_SOCKET_DIR!;
    process.kill(pid, "SIGKILL");
    await rm(join(socketDir, "bb.pid"));
    const before = (await calls()).length;
    await expect(session.run(["get", "url"], 5_000, signal)).rejects.toThrow(
      "daemon for this session exited",
    );
    await session.close();
    expect((await calls()).length).toBe(before);
    expect(await readdir(join(root, "tmp"))).toEqual([]);
  });
});
