/**
 * Real end-to-end check, no BB core needed: installs the pinned agent-browser
 * release into a disposable data directory, then drives real headless Chrome
 * through the same runtime the host worker uses.
 *
 *   npm run smoke
 *   AGENT_BROWSER_SMOKE_KEEP=/tmp/ab-smoke npm run smoke   # keep artifacts
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkArgs } from "./guard.js";
import { resolveRuntime } from "./runtime-pin.js";
import { createRuntime, jpegSize, type RuntimeSession } from "./runtime.js";

const page = `<!doctype html><title>Smoke</title>
<body style="font:16px sans-serif;margin:80px">
<h1>Cursor smoke</h1>
<button id="go" style="margin-left:400px;margin-top:200px;padding:12px 24px"
  onclick="document.title='Clicked';this.textContent='Clicked'">Click me</button>
</body>`;

const started = Date.now();
const step = (label: string) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${label}`);

const keep = process.env.AGENT_BROWSER_SMOKE_KEEP;
const root = await mkdtemp(join(tmpdir(), "ab-smoke-"));
const server = createServer((_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(page);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");
const url = `http://127.0.0.1:${address.port}/`;
const lifecycle = new AbortController();
// Closed in `finally`, so a failed assertion never leaves a daemon behind.
let opened: RuntimeSession | null = null;

try {
  const dataDir = process.env.AGENT_BROWSER_SMOKE_DATA ?? join(root, "data");
  const runtime = await resolveRuntime({
    dataDir,
    chrome: true,
    signal: lifecycle.signal,
    onProgress: step,
  });
  step(`runtime ready: ${runtime.binary} (${runtime.version})`);

  const warm = Date.now();
  await resolveRuntime({ dataDir, chrome: true, signal: lifecycle.signal });
  step(`warm resolve took ${Date.now() - warm} ms`);

  const session = await createRuntime({
    runtime,
    dataDir,
    tempDir: join(root, "tmp"),
    inputMode: "human",
    cursor: true,
    ignoreHttpsErrors: false,
    idleTimeoutMs: 5 * 60_000,
    signal: lifecycle.signal,
  });
  opened = session;
  step(`session open; cursor ${JSON.stringify(session.cursor)}`);
  assert(session.preview, "local sessions have a preview");

  const run = async (...args: string[]) => {
    checkArgs(args);
    const output = await session.run(args, 60_000, lifecycle.signal);
    step(`$ ${args.join(" ")} -> exit ${output.exitCode}`);
    return output;
  };

  assert.equal((await run("open", url)).exitCode, 0);
  const snapshot = await run("snapshot", "-i");
  assert.match(snapshot.text, /button "Click me"/);
  const ref = snapshot.text.match(/button "Click me" \[ref=(e\d+)\]/)?.[1];
  assert(ref, "snapshot names the button ref");

  // Watch the preview while a human-mode click is in flight.
  const frames: {
    sequence: number;
    data: string;
    width: number;
    height: number;
  }[] = [];
  let watching = true;
  const watcher = (async () => {
    let after = 0;
    while (watching) {
      const frame = await session.preview!.next(
        after,
        1_000,
        lifecycle.signal,
        "full",
      );
      if (!frame) continue;
      after = frame.sequence;
      frames.push(frame);
    }
  })();
  await run("wait", "400");
  const clickStarted = Date.now();
  assert.equal((await run("click", `@${ref}`)).exitCode, 0);
  step(`human click took ${Date.now() - clickStarted} ms`);
  await run("wait", "400");
  watching = false;
  await watcher;
  step(`preview delivered ${frames.length} frames during the click`);
  // About 1.7 s of motion at up to 8 fps. A preview attached to the wrong tab
  // delivers zero or one frame, so "a couple" is not enough to pass.
  assert(frames.length >= 6, "preview streams while commands run");
  const last = frames.at(-1)!;
  const pixels = jpegSize(Buffer.from(last.data, "base64"));
  step(
    `last frame reports ${last.width}x${last.height}, JPEG is ${pixels?.width}x${pixels?.height}`,
  );
  assert.equal((await run("get", "title")).text.trim(), "Clicked");

  const failure = await run("click", "@e999");
  assert.notEqual(failure.exitCode, 0);
  assert.match(failure.text, /e999/);

  const shot = await session.screenshot(
    { full: false, annotate: false },
    lifecycle.signal,
  );
  step(`screenshot: ${JSON.stringify(shot.images)}`);
  assert.equal(shot.exitCode, 0);
  assert.equal(shot.images.length, 1);

  const take = await session.recording(lifecycle.signal);
  step(`recording: ${JSON.stringify(take)}`);
  if (session.cursor.enabled) {
    assert(take.recording, "cursor sessions produce a recording take");
    assert(take.recording.bytes > 0, "the take has video data");
  } else assert.equal(take.recording, null);

  for (const blocked of [
    ["close"],
    ["record", "stop"],
    ["open", url, "--headed"],
    ["snapshot", "--session", "other"],
    ["batch", "get url", "close"],
    ["--json", "snapshot"],
  ])
    assert.throws(() => checkArgs(blocked), Error, blocked.join(" "));

  if (keep) {
    await mkdir(keep, { recursive: true });
    for (const [index, frame] of frames.entries())
      await writeFile(
        join(keep, `frame-${String(index).padStart(3, "0")}.jpg`),
        Buffer.from(frame.data, "base64"),
      );
    await copyFile(shot.images[0]!.path, join(keep, "screenshot.jpg"));
    if (take.recording)
      await copyFile(take.recording.path, join(keep, "recording.webm"));
    step(`kept ${frames.length} frames, a screenshot, and the take in ${keep}`);
  }

  await session.close();
  step("session closed");
  await assert.rejects(session.run(["get", "url"], 5_000, lifecycle.signal));
  assert.deepEqual(await readdir(join(root, "tmp")), []);
  console.log("agent-browser smoke passed");
} finally {
  await opened?.close();
  lifecycle.abort();
  server.close();
  await rm(root, { recursive: true, force: true });
}
