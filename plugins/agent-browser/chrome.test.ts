import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromeAvailable, installChrome } from "./chrome.js";

let root: string;
const env = () => ({ HOME: join(root, "home"), PATH: join(root, "bin") });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ab-chrome-"));
  await mkdir(join(root, "home"));
  await mkdir(join(root, "bin"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// macOS also checks /Applications, which a developer machine usually has.
describe.skipIf(process.platform === "darwin")("Chrome discovery", () => {
  it("reports no Chrome on an empty host", async () => {
    expect(await chromeAvailable(join(root, "data"), env())).toBe(false);
  });
  it("accepts the plugin data override", async () => {
    await mkdir(join(root, "data", "runtime"), { recursive: true });
    await writeFile(join(root, "data", "runtime", "chrome"), "", {
      mode: 0o755,
    });
    expect(await chromeAvailable(join(root, "data"), env())).toBe(true);
  });
  it("accepts agent-browser's Chrome for Testing cache", async () => {
    const cache = join(root, "home", ".agent-browser", "browsers");
    await mkdir(join(cache, "not-chrome"), { recursive: true });
    expect(await chromeAvailable(join(root, "data"), env())).toBe(false);
    await mkdir(join(cache, "chrome-152.0.7977.54"));
    expect(await chromeAvailable(join(root, "data"), env())).toBe(true);
  });
  it("accepts a system browser on PATH only when it is executable", async () => {
    const chromium = join(root, "bin", "chromium");
    await writeFile(chromium, "", { mode: 0o644 });
    expect(await chromeAvailable(join(root, "data"), env())).toBe(false);
    await chmod(chromium, 0o755);
    expect(await chromeAvailable(join(root, "data"), env())).toBe(true);
  });
});

describe("Chrome for Testing download", () => {
  async function fakeBinary(body: string) {
    const binary = join(root, "bin", "agent-browser");
    await writeFile(binary, `#!${process.execPath}\n${body}`, { mode: 0o755 });
    return binary;
  }
  it("runs agent-browser install with a minimal environment", async () => {
    const log = join(root, "install.json");
    const binary = await fakeBinary(
      `require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), env: process.env }));`,
    );
    await installChrome(binary, new AbortController().signal, {
      ...env(),
      HTTPS_PROXY: "http://proxy.test:8080",
      AGENT_BROWSER_HEADED: "1",
      SECRET_TOKEN: "x",
    });
    const call = JSON.parse(await readFile(log, "utf8"));
    expect(call.args).toEqual(["install"]);
    expect(call.env.HOME).toBe(join(root, "home"));
    expect(call.env.HTTPS_PROXY).toBe("http://proxy.test:8080");
    expect(call.env.AGENT_BROWSER_HEADED).toBeUndefined();
    expect(call.env.SECRET_TOKEN).toBeUndefined();
  });
  it("explains a failed download and how to supply Chrome instead", async () => {
    const binary = await fakeBinary(
      `process.stderr.write("network unreachable"); process.exit(1);`,
    );
    await expect(
      installChrome(binary, new AbortController().signal, env()),
    ).rejects.toThrow(/network unreachable/);
    await expect(
      installChrome(binary, new AbortController().signal, env()),
    ).rejects.toThrow(/runtime\/chrome/);
  });
  it("stops the download when cancelled", async () => {
    const binary = await fakeBinary(`setInterval(() => {}, 1000);`);
    const abort = new AbortController();
    const pending = installChrome(binary, abort.signal, env());
    setTimeout(() => abort.abort(), 100);
    await expect(pending).rejects.toThrow("cancelled");
  });
});
