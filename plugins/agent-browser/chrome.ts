import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const macCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];
const linuxNames = [
  "google-chrome",
  "google-chrome-stable",
  "chromium-browser",
  "chromium",
  "brave-browser",
  "brave-browser-stable",
];

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirrors where agent-browser itself looks for Chrome: the plugin's
 * `runtime/chrome` override, its Chrome for Testing cache, then a system
 * browser. agent-browser makes the actual choice at launch.
 */
export async function chromeAvailable(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (await executable(join(dataDir, "runtime", "chrome"))) return true;
  try {
    const cache = join(env.HOME ?? homedir(), ".agent-browser", "browsers");
    if ((await readdir(cache)).some((entry) => entry.startsWith("chrome-")))
      return true;
  } catch {}
  if (process.platform === "darwin") {
    for (const candidate of macCandidates)
      if (await executable(candidate)) return true;
    return false;
  }
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean))
    for (const name of linuxNames)
      if (await executable(join(dir, name))) return true;
  return false;
}

/** Runs `agent-browser install`, which downloads Chrome for Testing. */
export function installChrome(
  binary: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  signal.throwIfAborted();
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
  ]) {
    if (env[key]) childEnv[key] = env[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["install"], {
      env: childEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)]);
    const abort = () => child.kill("SIGKILL");
    deadline.addEventListener("abort", abort, { once: true });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 16_000) stderr += chunk;
    });
    child.once("error", (error) => {
      deadline.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      deadline.removeEventListener("abort", abort);
      if (deadline.aborted)
        reject(new Error("Chrome for Testing download was cancelled"));
      else if (code === 0) resolve();
      else
        reject(
          new Error(
            `agent-browser could not download Chrome for Testing on this host (exit ${code}). Install Chrome or Chromium there, or link an executable at the plugin data runtime/chrome path. ${stderr.trim().slice(-1_000)}`,
          ),
        );
    });
  });
}
