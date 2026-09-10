import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";
import type { ExperimentalHostClient } from "@get-bb/plugin-sdk";
import type { cowHostContract, cowHostSignals } from "./contract.js";

type CowHostClient = ExperimentalHostClient<
  typeof cowHostContract,
  typeof cowHostSignals
>;

const CONVERT_TIMEOUT_MS = 30 * 60 * 1000;
const STATUS_TIMEOUT_MS = 60 * 1000;

const USAGE = `Usage:
  bb btrfs-cow status  --machine <id-or-name> <path>   Report copy mode for a checkout
  bb btrfs-cow convert --machine <id-or-name> <path>   Turn a checkout into a Btrfs subvolume so threads snapshot it
Options:
  --json    Machine-readable output
`;

interface ParsedArgs {
  command: string | null;
  machine: string | null;
  path: string | null;
  json: boolean;
  error: string | null;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { command: null, machine: null, path: null, json: false, error: null };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--machine" || arg === "--host") {
      const value = argv[i + 1];
      if (value === undefined) {
        parsed.error = `${arg} needs a value`;
        return parsed;
      }
      parsed.machine = value;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("--")) {
      parsed.error = `Unknown option ${arg}`;
      return parsed;
    } else if (arg !== undefined) rest.push(arg);
  }
  parsed.command = rest[0] ?? null;
  parsed.path = rest[1] ?? null;
  if (rest.length > 2) parsed.error = `Unexpected argument ${rest[2]}`;
  return parsed;
}

function fail(message: string): PluginCliResult {
  return { exitCode: 1, stderr: `${message}\n${USAGE}` };
}

export function registerCli(bb: BbPluginApi, host: CowHostClient): void {
  bb.cli.register({
    name: "btrfs-cow",
    summary: "Inspect and prepare checkouts for copy-on-write thread environments",
    commands: [
      {
        name: "status",
        summary: "Report whether a checkout will be snapshotted or reflink-copied",
        usage: "bb btrfs-cow status --machine <id-or-name> <path> [--json]",
      },
      {
        name: "convert",
        summary: "Replace a checkout directory with a Btrfs subvolume of the same contents",
        usage: "bb btrfs-cow convert --machine <id-or-name> <path> [--json]",
      },
    ],
    async run(argv, ctx) {
      const args = parseArgs(argv);
      if (args.error !== null) return fail(args.error);
      if (args.command === null || args.command === "help") {
        return { exitCode: 0, stdout: USAGE };
      }
      if (args.command !== "status" && args.command !== "convert") {
        return fail(`Unknown command ${args.command}`);
      }
      if (args.path === null) return fail("A checkout path is required");
      if (args.machine === null) return fail("--machine is required");

      const hosts = await bb.sdk.hosts.list(
        ctx.signal !== undefined ? { signal: ctx.signal } : {},
      );
      const matches = hosts.filter(
        (candidate) => candidate.id === args.machine || candidate.name === args.machine,
      );
      const machine = matches[0];
      if (machine === undefined) return fail(`No machine matches ${args.machine}`);
      if (matches.length > 1) return fail(`Machine name ${args.machine} is ambiguous; use its id`);

      const callOptions = {
        hostId: machine.id,
        ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      };

      if (args.command === "status") {
        const status = await host.call("status", { path: args.path }, { ...callOptions, timeoutMs: STATUS_TIMEOUT_MS });
        if (args.json) return { exitCode: 0, stdout: `${JSON.stringify(status, null, 2)}\n` };
        const lines = [
          `Path: ${status.path} (${machine.name})`,
          `Filesystem: ${status.filesystem ?? "unknown"}`,
          `Subvolume: ${status.isSubvolume ? "yes" : "no"}`,
          `Reflink copies: ${status.reflinkSupported ? "supported" : `not supported (${status.reflinkMessage ?? "unknown"})`}`,
          `Snapshot delete without root: ${status.subvolumeDeleteAllowed === null ? "n/a" : status.subvolumeDeleteAllowed ? "yes" : "no (mount option user_subvol_rm_allowed missing; teardown falls back to rm)"}`,
          `Thread environments would use: ${status.mode === null ? "unavailable" : status.mode === "snapshot" ? "snapshot (constant time)" : "reflink copy (per-file); run `bb btrfs-cow convert` to enable snapshots"}`,
        ];
        return { exitCode: status.exists ? 0 : 1, stdout: `${lines.join("\n")}\n` };
      }

      const result = await host.call(
        "convert",
        { path: args.path, timeoutMs: CONVERT_TIMEOUT_MS },
        { ...callOptions, timeoutMs: CONVERT_TIMEOUT_MS },
      );
      if (args.json) return { exitCode: result.status === "converted" ? 0 : 1, stdout: `${JSON.stringify(result, null, 2)}\n` };
      if (result.status === "failed") return { exitCode: 1, stderr: `Convert failed: ${result.message}\n` };
      return {
        exitCode: 0,
        stdout: `Converted ${result.path} on ${machine.name} to a Btrfs subvolume. New threads will snapshot it.\n`,
      };
    },
  });
}
