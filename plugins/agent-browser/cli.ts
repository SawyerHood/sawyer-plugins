import { z } from "zod";
import { inputModeSchema, type rpcContract } from "./contracts.js";
import { checkArgs } from "./guard.js";

export const commands = [
  {
    name: "open",
    summary:
      "Open a thread-owned agent-browser session: local headless Chrome, or a BB desktop tab with --desktop; --cursor adds a visible pointer and a recording",
    usage:
      "bb agent-browser open --machine <host-id> [--desktop <instance-id> [--tab <tab-id>]] [--cursor] [--input-mode human|smooth|instant] [--ignore-https-errors] [--thread <id>]",
  },
  {
    name: "list",
    summary: "List this thread's browser sessions",
    usage: "bb agent-browser list [--thread <id>]",
  },
  {
    name: "run",
    summary:
      "Run one agent-browser command in the session (snapshot, click, fill, batch, …); prints agent-browser's own output",
    usage:
      "bb agent-browser run <session-id> [--timeout-ms <1000..300000>] [--json] [--thread <id>] -- <agent-browser command> [args]",
  },
  {
    name: "screenshot",
    summary: "Save a bounded JPEG in session storage; return its path and host",
    usage:
      "bb agent-browser screenshot <session-id> [--full] [--annotate] [--thread <id>]",
  },
  {
    name: "recording",
    summary:
      "For a session opened with --cursor: finish the current recording take and return the WebM path; recording continues in a new take",
    usage: "bb agent-browser recording <session-id> [--thread <id>]",
  },
  {
    name: "preview",
    summary:
      "Describe the live preview frame of a local headless session, without image bytes",
    usage:
      "bb agent-browser preview <session-id> [--after <sequence>] [--thread <id>]",
  },
  {
    name: "stop",
    summary:
      "Cancel queued and running work and release control; open a new session to resume",
    usage: "bb agent-browser stop <session-id> [--thread <id>]",
  },
  {
    name: "close",
    summary: "Dispose owned browsers and tabs, preserving handed-off tabs",
    usage: "bb agent-browser close <session-id> [--thread <id>]",
  },
];
const methodSchema = z.enum([
  "open",
  "list",
  "run",
  "screenshot",
  "recording",
  "preview",
  "stop",
  "close",
]);
export type CliMethod = z.infer<typeof methodSchema>;

const booleanFlags = new Set([
  "--json",
  "--cursor",
  "--ignore-https-errors",
  "--full",
  "--annotate",
]);

export interface ParsedCli {
  method: CliMethod;
  json: boolean;
  input: {
    threadId: string;
    sessionId?: string;
    selection?: z.input<typeof rpcContract.open.input>["selection"];
    inputMode?: z.input<typeof inputModeSchema>;
    cursor?: boolean;
    ignoreHttpsErrors?: boolean;
    args?: string[];
    timeoutMs?: number;
    full?: boolean;
    annotate?: boolean;
    afterSequence?: number;
  };
}

export function parseCli(argv: string[], contextThreadId?: string): ParsedCli {
  const method = methodSchema.parse(argv[0]);
  const flags = new Map<string, string>();
  const positionals: string[] = [];
  let passthrough: string[] | null = null;
  const allowed = new Set([
    "--json",
    "--thread",
    ...(method === "open"
      ? [
          "--machine",
          "--desktop",
          "--tab",
          "--input-mode",
          "--cursor",
          "--ignore-https-errors",
        ]
      : method === "run"
        ? ["--timeout-ms"]
        : method === "screenshot"
          ? ["--full", "--annotate"]
          : method === "preview"
            ? ["--after"]
            : []),
  ]);
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]!;
    // `run` hands everything after the session ID's own flags to
    // agent-browser: from an explicit `--`, or from the first token that is
    // not one of this command's flags.
    if (method === "run" && positionals.length === 1) {
      if (arg === "--") {
        passthrough = argv.slice(index + 1);
        break;
      }
      if (!allowed.has(arg)) {
        passthrough = argv.slice(index);
        break;
      }
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    if (!allowed.has(arg) || flags.has(arg))
      throw new Error(`Unknown or duplicate flag: ${arg}`);
    if (booleanFlags.has(arg)) flags.set(arg, "true");
    else {
      const value = argv[++index];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      flags.set(arg, value);
    }
  }
  const threadId = flags.get("--thread") ?? contextThreadId;
  if (!threadId) throw new Error("Run from a BB thread or pass --thread <id>");
  if (contextThreadId && threadId !== contextThreadId)
    throw new Error(
      "CLI calls from a thread cannot access another thread's browser session",
    );
  const input: ParsedCli["input"] = { threadId };
  if (method === "open" || method === "list") {
    if (positionals.length) throw new Error("Unexpected positional argument");
  } else {
    if (positionals.length !== 1) throw new Error("Expected one session ID");
    input.sessionId = positionals[0];
  }
  if (method === "open") {
    const hostId = flags.get("--machine");
    if (!hostId)
      throw new Error("Select the browser host with --machine <host-id>");
    const instanceId = flags.get("--desktop");
    if (instanceId === undefined) {
      if (flags.has("--tab"))
        throw new Error("--tab hands off a desktop tab; add --desktop <id>");
      input.selection = { backend: "local", hostId };
    } else
      input.selection = {
        backend: "desktop",
        hostId,
        instanceId,
        ...(flags.has("--tab") ? { tabId: flags.get("--tab") } : {}),
      };
    // A pointer nobody can see is only slower, so human-paced movement is
    // the default exactly when the cursor is on.
    const cursor = flags.has("--cursor");
    const inputMode = inputModeSchema.safeParse(
      flags.get("--input-mode") ?? (cursor ? "human" : "instant"),
    );
    if (!inputMode.success)
      throw new Error("--input-mode must be human, smooth, or instant");
    input.inputMode = inputMode.data;
    input.cursor = cursor;
    input.ignoreHttpsErrors = flags.has("--ignore-https-errors");
  }
  if (method === "run") {
    if (!passthrough || passthrough.length === 0)
      throw new Error(
        "Supply an agent-browser command after the session ID, e.g. `-- snapshot -i`",
      );
    checkArgs(passthrough);
    input.args = passthrough;
    input.timeoutMs = flags.has("--timeout-ms")
      ? Number(flags.get("--timeout-ms"))
      : 60_000;
  }
  if (method === "screenshot") {
    input.full = flags.has("--full");
    input.annotate = flags.has("--annotate");
  }
  if (method === "preview")
    input.afterSequence = flags.has("--after")
      ? Number(flags.get("--after"))
      : 0;
  return { method, json: flags.has("--json"), input };
}
