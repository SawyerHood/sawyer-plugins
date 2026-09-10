import { spawn } from "node:child_process";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly result: RunResult,
  ) {
    super(message);
  }
}

export class CancelledError extends Error {
  constructor() {
    super("The operation was cancelled");
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancelledError();
}

export async function run(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string | undefined;
    timeoutMs?: number | undefined;
    signal?: AbortSignal | undefined;
    allowFailure?: boolean | undefined;
    env?: NodeJS.ProcessEnv | undefined;
  } = {},
): Promise<RunResult> {
  throwIfAborted(options.signal);
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      child.kill("SIGTERM");
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() =>
          reject(
            new CommandError(
              `${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`,
              { exitCode: -1, stdout, stderr },
            ),
          ),
        );
      }, options.timeoutMs);
    }
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      const result = { exitCode: code ?? -1, stdout, stderr };
      finish(() => {
        if (options.signal?.aborted) {
          reject(new CancelledError());
        } else if (result.exitCode !== 0 && !options.allowFailure) {
          reject(
            new CommandError(
              `${command} ${args.join(" ")} exited with ${result.exitCode}: ${stderr.trim() || stdout.trim()}`,
              result,
            ),
          );
        } else {
          resolve(result);
        }
      });
    });
  });
}
