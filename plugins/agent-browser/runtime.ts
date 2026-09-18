import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  outputSchema,
  type CursorState,
  type InputMode,
  type RecordingOutput,
  type RunOutput,
} from "./contracts.js";
import { createPreview, type PreviewSource } from "./preview.js";
import { execute, type ExecuteResult } from "./process.js";
import type { ResolvedRuntime } from "./runtime-pin.js";

const sessionName = "bb";
const recordingFps = 15;
const navigationCommands = new Set(["open", "goto", "navigate"]);
const maxScreenshotBytes = 4_000_000;
const maxTextChars = 160_000;

const recordResultSchema = z
  .object({
    success: z.boolean(),
    data: z.object({ previousPath: z.string().nullish() }).loose().nullish(),
    error: z.unknown().optional(),
  })
  .loose();

export function runtimeEnvironment(args: {
  home: string;
  socketDir: string;
  idleTimeoutMs: number;
  chrome: string | null;
  connectionUrl: string | undefined;
  ignoreHttpsErrors: boolean;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.AGENT_BROWSER_SESSION = sessionName;
  env.AGENT_BROWSER_SOCKET_DIR = args.socketDir;
  // An explicit config file replaces the user's and the project's, so a stray
  // `headed` or `profile` default cannot change what a BB session launches.
  env.AGENT_BROWSER_CONFIG = join(args.home, "config.json");
  // The daemon outlives a crashed worker; this makes it end itself soon after
  // the session's own idle cleanup would have.
  env.AGENT_BROWSER_IDLE_TIMEOUT_MS = String(args.idleTimeoutMs + 60_000);
  env.AGENT_BROWSER_SCREENSHOT_DIR = join(args.home, "captures");
  env.AGENT_BROWSER_SCREENSHOT_FORMAT = "jpeg";
  env.AGENT_BROWSER_SCREENSHOT_QUALITY = "70";
  env.AGENT_BROWSER_DOWNLOAD_PATH = join(args.home, "files");
  env.AGENT_BROWSER_MAX_OUTPUT = "100000";
  if (args.chrome) env.AGENT_BROWSER_EXECUTABLE_PATH = args.chrome;
  if (args.connectionUrl) env.AGENT_BROWSER_CDP = args.connectionUrl;
  if (args.ignoreHttpsErrors) env.AGENT_BROWSER_IGNORE_HTTPS_ERRORS = "1";
  return env;
}

export function redact(text: string, connectionUrl: string | undefined) {
  if (!connectionUrl) return text;
  let safe = text.split(connectionUrl).join("[browser connection]");
  const endpoint = new URL(connectionUrl);
  const credential = endpoint.pathname.split("/").filter(Boolean).at(-1);
  if (credential && credential.length >= 16) {
    safe = safe
      .split(endpoint.pathname)
      .join("[browser connection]")
      .split(credential)
      .join("[credential]");
  }
  for (const value of endpoint.searchParams.values())
    if (value) safe = safe.split(value).join("[credential]");
  return safe;
}

export function commandText(
  result: ExecuteResult,
  connectionUrl: string | undefined,
): string {
  const text = [result.stdout.trimEnd(), result.stderr.trimEnd()]
    .filter(Boolean)
    .join("\n");
  const safe = redact(text, connectionUrl);
  return safe.length > maxTextChars
    ? `${safe.slice(0, maxTextChars - 40)}\n[output truncated by BB]`
    : safe;
}

/** Reads the pixel size from a JPEG's start-of-frame segment. */
export function jpegSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    const startOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (startOfFrame) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

async function findChromeOverride(dataDir: string): Promise<string | null> {
  const candidate = join(dataDir, "runtime", "chrome");
  try {
    await access(candidate, constants.X_OK);
    return await realpath(candidate);
  } catch {
    return null;
  }
}

function firstLine(text: string): string {
  const line =
    text
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  return line.replace(/^✗\s*/, "").slice(0, 300);
}

export interface RuntimeSession {
  /** Current state; a cursor that failed on open can start on a later page. */
  readonly cursor: CursorState;
  run(
    args: string[],
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<RunOutput>;
  screenshot(
    options: { full: boolean; annotate: boolean },
    signal: AbortSignal,
  ): Promise<RunOutput>;
  recording(signal: AbortSignal): Promise<RecordingOutput>;
  preview: PreviewSource | null;
  close(): Promise<void>;
}

export async function createRuntime(args: {
  runtime: ResolvedRuntime;
  dataDir: string;
  tempDir: string;
  connectionUrl?: string;
  inputMode: InputMode;
  cursor: boolean;
  ignoreHttpsErrors: boolean;
  idleTimeoutMs: number;
  signal: AbortSignal;
}): Promise<RuntimeSession> {
  const binary = args.runtime.binary;
  const connectionUrl = args.connectionUrl;
  if (connectionUrl !== undefined) {
    const endpoint = new URL(connectionUrl);
    if (
      endpoint.protocol !== "ws:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
    )
      throw new Error(
        "Desktop connection must be a private loopback WebSocket on the selected host",
      );
  }
  await mkdir(args.tempDir, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(join(args.tempDir, "ab-"));
  // Unix socket paths are limited to about 100 bytes, so the daemon's socket
  // lives in a short private directory instead of the session directory.
  const socketDir = await mkdtemp(join(tmpdir(), "bbab-"));
  const captures = join(home, "captures");
  const recordings = join(home, "recordings");
  const files = join(home, "files");
  let closed = false;
  let closing: Promise<void> | null = null;
  let preview: PreviewSource | null = null;
  let daemonPid: number | null = null;
  let take = 1;
  const stopped = new AbortController();
  let queue = Promise.resolve();
  const pidFile = join(socketDir, `${sessionName}.pid`);
  const readPid = async (): Promise<number | null> => {
    try {
      const pid = Number((await readFile(pidFile, "utf8")).trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  };
  let env: NodeJS.ProcessEnv = {};
  const invoke = (commandArgs: string[], signal: AbortSignal) =>
    execute(binary, commandArgs, { env, cwd: files, signal });

  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    stopped.abort();
    preview?.close();
    closing = (async () => {
      await queue;
      // Without its daemon the CLI would start a new one just to close it.
      if (daemonPid !== null && (await readPid()) === daemonPid) {
        await invoke(["close"], AbortSignal.timeout(10_000)).catch(() => {});
        // A clean exit removes the PID file. Signal only a daemon that still
        // claims this session's socket directory, which no one else can write.
        for (const signal of ["SIGTERM", "SIGKILL"] as const) {
          const deadline = Date.now() + 1_500;
          while (Date.now() < deadline && (await readPid()) === daemonPid)
            await delay(50);
          if ((await readPid()) !== daemonPid) break;
          try {
            process.kill(daemonPid, signal);
          } catch {
            break;
          }
        }
      }
      await rm(home, { recursive: true, force: true });
      await rm(socketDir, { recursive: true, force: true });
    })();
    return closing;
  };

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      if (closed)
        throw new Error("Browser session stopped; open a new session");
      // The CLI would silently start a fresh daemon and browser; a session
      // whose daemon is gone has lost its pages, so end it instead.
      if (daemonPid !== null && (await readPid()) !== daemonPid) {
        void close();
        throw new Error(
          "The agent-browser daemon for this session exited; open a new session",
        );
      }
      return work();
    });
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  try {
    await Promise.all(
      [captures, recordings, files].map((dir) =>
        mkdir(dir, { recursive: true, mode: 0o700 }),
      ),
    );
    env = runtimeEnvironment({
      home,
      socketDir,
      idleTimeoutMs: args.idleTimeoutMs,
      chrome:
        connectionUrl === undefined
          ? await findChromeOverride(args.dataDir)
          : null,
      connectionUrl,
      ignoreHttpsErrors: args.ignoreHttpsErrors,
    });
    await writeFile(env.AGENT_BROWSER_CONFIG!, "{}\n", { mode: 0o600 });
    const startup = AbortSignal.any([args.signal, AbortSignal.timeout(60_000)]);
    const started = await invoke(
      connectionUrl === undefined
        ? ["open", "about:blank", "--input-mode", args.inputMode]
        : ["get", "url", "--input-mode", args.inputMode],
      startup,
    );
    daemonPid = await readPid();
    if (started.code !== 0 || daemonPid === null)
      throw new Error(
        `agent-browser could not start the browser session. ${commandText(started, connectionUrl).slice(0, 1_500)}`,
      );
    // Headless Chrome's default window leaves a 1280x577 page; 16:9 suits the
    // preview card and the recording. Desktop tabs keep the size BB gave them.
    if (connectionUrl === undefined)
      await invoke(["set", "viewport", "1280", "720"], startup);
    let cursor: CursorState = {
      enabled: false,
      detail: "Open the session with --cursor for a visible pointer and a recording",
    };
    let cursorRetries = args.cursor ? 2 : 0;
    const startCursor = async (signal: AbortSignal) => {
      const recording = await invoke(
        [
          "record",
          "start",
          join(recordings, `take-${take}.webm`),
          "--cursor",
          "--fps",
          String(recordingFps),
        ],
        signal,
      );
      const failure =
        firstLine(commandText(recording, connectionUrl)) ||
        "agent-browser could not start the cursor recording";
      cursor =
        recording.code === 0
          ? { enabled: true, detail: null }
          : {
              enabled: false,
              detail: failure.includes("scoped page sessions")
                ? `BB's desktop browser bridge does not yet allow a call the agent-browser recorder needs. ${failure}`.slice(
                    0,
                    400,
                  )
                : failure,
            };
    };
    // A new desktop tab cannot be captured until it has painted a page, so
    // that attempt would only spend the bridge's screenshot timeout.
    if (args.cursor && connectionUrl === undefined) await startCursor(startup);
    else if (args.cursor)
      cursor = {
        enabled: false,
        detail: "The cursor starts once the desktop tab has loaded a page",
      };
    if (connectionUrl === undefined) {
      const endpoint = (await invoke(["get", "cdp-url"], startup)).stdout.trim();
      const url = new URL(endpoint);
      if (
        url.protocol !== "ws:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
        throw new Error("agent-browser reported an unexpected CDP endpoint");
      preview = createPreview(endpoint);
    }
    const run = (
      commandArgs: string[],
      timeoutMs: number,
      signal: AbortSignal,
    ): Promise<RunOutput> =>
      enqueue(async () => {
        const timeout = AbortSignal.timeout(timeoutMs);
        try {
          const result = await invoke(
            commandArgs,
            AbortSignal.any([signal, stopped.signal, timeout]),
          );
          // A desktop tab cannot be captured before its first paint, which
          // fails the recording on open; its first pages are the time to retry.
          if (
            !cursor.enabled &&
            cursorRetries > 0 &&
            result.code === 0 &&
            navigationCommands.has(commandArgs[0]!)
          ) {
            cursorRetries--;
            await startCursor(
              AbortSignal.any([
                signal,
                stopped.signal,
                AbortSignal.timeout(30_000),
              ]),
            ).catch(() => {});
          }
          return outputSchema.parse({
            text: commandText(result, connectionUrl),
            images: [],
            exitCode: result.code ?? 1,
          });
        } catch (error) {
          if (!timeout.aborted || signal.aborted || stopped.signal.aborted)
            throw error;
          return {
            text: `agent-browser did not finish within ${timeoutMs} ms. The session is still open; the browser may still be completing the command.`,
            images: [],
            exitCode: 124,
          };
        }
      });
    const screenshot: RuntimeSession["screenshot"] = (options, signal) =>
      enqueue(async () => {
        const target = join(captures, `${randomUUID()}.jpg`);
        const result = await invoke(
          [
            "screenshot",
            target,
            ...(options.full ? ["--full"] : []),
            ...(options.annotate ? ["--annotate"] : []),
          ],
          AbortSignal.any([
            signal,
            stopped.signal,
            AbortSignal.timeout(60_000),
          ]),
        );
        const text = commandText(result, connectionUrl);
        if (result.code !== 0)
          return { text, images: [], exitCode: result.code ?? 1 };
        const root = await realpath(captures);
        const path = await realpath(target);
        const rel = relative(root, path);
        if (!rel || rel.startsWith("..") || isAbsolute(rel))
          throw new Error("Screenshot escaped the session capture directory");
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > maxScreenshotBytes)
            return {
              text: "Screenshot is larger than 4 MB; capture without --full or scroll to the part you need",
              images: [],
              exitCode: 1,
            };
          const header = Buffer.alloc(Math.min(info.size, 262_144));
          await file.read(header, 0, header.length, 0);
          const size = jpegSize(header);
          if (!size) throw new Error("agent-browser did not write a JPEG");
          return outputSchema.parse({
            text,
            images: [{ path, mimeType: "image/jpeg", ...size }],
            exitCode: 0,
          });
        } finally {
          await file.close();
        }
      });
    const recording: RuntimeSession["recording"] = (signal) =>
      enqueue(async () => {
        if (!cursor.enabled)
          return {
            recording: null,
            detail: `This session has no recording. ${cursor.detail ?? ""}`
              .trim()
              .slice(0, 400),
          };
        const next = join(recordings, `take-${take + 1}.webm`);
        const result = await invoke(
          [
            "record",
            "restart",
            next,
            "--cursor",
            "--fps",
            String(recordingFps),
            "--json",
          ],
          AbortSignal.any([
            signal,
            stopped.signal,
            AbortSignal.timeout(60_000),
          ]),
        );
        let parsed: z.infer<typeof recordResultSchema> | null = null;
        try {
          parsed = recordResultSchema.parse(JSON.parse(result.stdout));
        } catch {}
        const previous = parsed?.success ? parsed.data?.previousPath : null;
        if (result.code !== 0 || !previous)
          return {
            recording: null,
            detail: `agent-browser could not finish the recording take. ${firstLine(commandText(result, connectionUrl))}`,
          };
        take++;
        const path = await realpath(previous);
        const rel = relative(await realpath(recordings), path);
        if (!rel || rel.startsWith("..") || isAbsolute(rel))
          throw new Error("Recording escaped the session recording directory");
        return {
          recording: {
            path,
            mimeType: "video/webm",
            bytes: (await stat(path)).size,
          },
          detail: null,
        };
      });
    return {
      get cursor() {
        return cursor;
      },
      run,
      screenshot,
      recording,
      preview,
      close,
    };
  } catch (error) {
    daemonPid ??= await readPid();
    await close();
    throw error;
  }
}
