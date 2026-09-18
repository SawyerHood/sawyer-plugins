import { spawn } from "node:child_process";

export interface ExecuteResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const maxOutputBytes = 512_000;

/**
 * Runs one agent-browser CLI invocation. The CLI is a short-lived client of
 * the session's daemon, so killing it on abort never touches the browser.
 */
export function execute(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; signal: AbortSignal },
): Promise<ExecuteResult> {
  const { signal } = options;
  if (signal.aborted)
    return Promise.reject(new Error("Browser work cancelled or timed out"));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let failure: Error | null = null;
    const abort = () => {
      failure = new Error("Browser work cancelled or timed out");
      child.kill("SIGKILL");
    };
    const collect = (chunk: string): boolean => {
      bytes += Buffer.byteLength(chunk);
      if (bytes <= maxOutputBytes) return true;
      failure = new Error(
        "agent-browser output exceeded 512 KB; narrow the command, e.g. `snapshot -i` or `get text <selector>`",
      );
      child.kill("SIGKILL");
      return false;
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (collect(chunk)) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (collect(chunk)) stderr += chunk;
    });
    child.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr });
    });
  });
}
