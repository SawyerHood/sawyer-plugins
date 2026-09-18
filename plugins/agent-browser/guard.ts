const lifecycle =
  "the BB session owns the browser lifecycle; use `bb agent-browser stop` or `bb agent-browser close`";
const attachment =
  "the BB session owns which browser is attached; open another session with `bb agent-browser open`";
const recording =
  "the BB session owns the cursor recording; use `bb agent-browser recording <session-id>` for the video";
const hostLevel = "it manages the host's agent-browser install, not a session";

const blockedCommands = new Map<string, string>([
  ["close", lifecycle],
  ["quit", lifecycle],
  ["exit", lifecycle],
  ["connect", attachment],
  ["session", attachment],
  ["profiles", attachment],
  ["device", attachment],
  ["record", recording],
  ["stream", "the BB live preview owns the session's frame stream"],
  ["inspect", "DevTools cannot open from a BB-owned session"],
  ["install", hostLevel],
  ["upgrade", hostLevel],
  ["doctor", hostLevel],
  ["dashboard", hostLevel],
  ["plugin", hostLevel],
  ["plugins", hostLevel],
  ["mcp", "it starts a server instead of running a browser command"],
  ["chat", "it starts an interactive AI chat instead of a browser command"],
]);

const launch =
  "it would relaunch the browser and drop the cursor overlay; choose launch options on `bb agent-browser open`";

const blockedFlags = new Map<string, string>([
  ["--session", attachment],
  ["--session-name", attachment],
  ["--namespace", attachment],
  ["--restore", attachment],
  ["--restore-save", attachment],
  ["--restore-check-url", attachment],
  ["--restore-check-text", attachment],
  ["--restore-check-fn", attachment],
  ["--cdp", attachment],
  ["--auto-connect", attachment],
  ["--provider", attachment],
  ["-p", attachment],
  ["--profile", attachment],
  ["--device", attachment],
  ["--engine", attachment],
  ["--config", attachment],
  ["--idle-timeout", lifecycle],
  ["--headed", launch],
  ["--executable-path", launch],
  ["--args", launch],
  ["--extension", launch],
  ["--state", launch],
  ["--proxy", launch],
  ["--proxy-bypass", launch],
  ["--user-agent", launch],
  ["--ignore-https-errors", launch],
  ["--ca-cert", launch],
  ["--no-ca-cert", launch],
  ["--allow-file-access", launch],
  ["--webgpu", launch],
  ["--no-webmcp", launch],
  ["--allowed-domains", launch],
]);

const commandPattern = /^[a-z][a-z0-9-]*$/;

function flagName(token: string): string | null {
  if (!token.startsWith("-")) return null;
  const equals = token.indexOf("=");
  return equals === -1 ? token : token.slice(0, equals);
}

function checkTokens(tokens: string[], where: string): void {
  const command = tokens[0];
  if (command === undefined || !commandPattern.test(command))
    throw new Error(
      `Put the agent-browser command first${where}, then its arguments and flags, e.g. \`snapshot -i\` or \`click @e2\``,
    );
  const reason = blockedCommands.get(command);
  if (reason)
    throw new Error(
      `agent-browser \`${command}\` is unavailable${where}: ${reason}`,
    );
  for (const token of tokens.slice(1)) {
    const name = flagName(token);
    const blocked = name === null ? undefined : blockedFlags.get(name);
    if (blocked)
      throw new Error(
        `agent-browser flag ${name} is unavailable${where}: ${blocked}`,
      );
  }
}

/**
 * Rejects agent-browser invocations that would detach the daemon from the BB
 * session (another session, browser, or profile), end it behind BB's back, or
 * relaunch Chrome. Everything else passes through to agent-browser unchanged.
 */
export function checkArgs(args: string[]): void {
  checkTokens(args, "");
  if (args[0] !== "batch") return;
  for (const entry of args.slice(1)) {
    if (entry.startsWith("-")) continue;
    checkTokens(entry.trim().split(/\s+/), " inside batch");
  }
}
