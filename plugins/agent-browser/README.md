# Agent Browser for BB

Thread-owned browser automation built on
[agent-browser](https://github.com/vercel-labs/agent-browser), with an optional
visible cursor and recording. It is a sibling of BB's built-in Browser
Automation plugin: the same session ownership, host workers, desktop
attachment, and live preview card, with agent-browser as the engine instead of
DevBrowser scripts.

What agent-browser 0.38 adds, which `bb agent-browser open --cursor` turns on:

- **A visible cursor.** `record start --cursor` paints an animated pointer and a
  click ripple into the page, so the pointer shows up in the live preview, in
  screenshots, and in the video.
- **Human-like movement.** `--cursor` sessions open with `--input-mode human`:
  the pointer travels a curved, eased path to each target instead of
  teleporting.
- **A recording to hand back.** `bb agent-browser recording <session-id>`
  returns the WebM of what the agent just did.

The cursor is **off by default**. agent-browser only paints it while a recording
runs, and that recorder encodes at a constant frame rate whether or not the page
changes: about a fifth of one CPU core on the browser host for as long as the
session is open, plus roughly half a second per human-paced click. Without
`--cursor` a session has no recording, no ffmpeg process, and instant input.

Requires BB 0.43 or newer (plugin SDK 0.4.99), for host workers, message
directives, the app overlay slot, and `bb.sdk.experimental_desktopBrowsers`.

## Host requirements

Everything runs on the **browser host** you pick with `--machine`, not on the
server or the invoking agent's machine.

| Need | Why | If it is missing |
| --- | --- | --- |
| Linux (glibc) or macOS, x64 or arm64 | pinned agent-browser binaries | `open` fails with a clear error; musl and Windows are not supported |
| `npm` 9.5+ on the host worker's `PATH`, network access | first install and its signature checks | `open` fails naming the requirement |
| Chrome or Chromium | local headless sessions | the plugin runs `agent-browser install`, which downloads Chrome for Testing into `~/.agent-browser/browsers` |
| `ffmpeg` with libvpx | only `--cursor` sessions | the session opens with `cursor: false` and says why; everything else works |

Chrome is resolved the way agent-browser resolves it: a symlink or executable at
`<plugin host dataDir>/runtime/chrome` wins, then agent-browser's Chrome for
Testing cache, then a system Chrome, Chromium, or Brave. agent-browser decides
by itself whether Chrome's sandbox has to be disabled (containers, root, CI);
the plugin never forces `--no-sandbox`.

## Runtime installation and provenance

The first `open` on a host installs agent-browser there, under
`<plugin host dataDir>/runtime/npm/`. The user's global npm installation and any
agent-browser already on `PATH` are never touched or used. `runtime-pin.ts` pins
one exact release:

| Field | Value |
| --- | --- |
| package | `agent-browser@0.38.1` from `registry.npmjs.org` |
| repository | [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) |
| commit | `aff6125c023b810ea3f2e5deec5379e9a4270bdc` (tag `v0.38.1`) |
| tarball integrity | `sha512-k58FCz0yUOCANoNkMiqJe+H2y6r6sUZazqXsWF+MYq1iRC42PjtLcBoag6SSTOD/FRQppvPDvE5HDYEhclvnhw==` |
| linux-x64 | `5100149a1903211c889de4e545bf36d90803740cea4f99aa22651649f9205ea1` |
| linux-arm64 | `937b315ee0761e8a62f7950ddcfef9b3d3d8e8d5eb9c9d2bf9e23e5725664511` |
| darwin-x64 | `9187f885f7da0a6d880ff6d2e7dea58e17bea490a1fec85bbb6a36067272ea8e` |
| darwin-arm64 | `2e61287259053ea964d39e77002c6a34af0e589e55ccff25e659efae7e892e0d` |

The npm tarball carries every platform's native binary, so nothing is downloaded
from GitHub. The installer (`installer.ts`, inside the plugin host worker):

1. Locates `npm` on the host worker's `PATH`.
2. Runs `npm install --ignore-scripts` of the exact version from the pinned
   registry, passed explicitly so a host `.npmrc` mirror cannot substitute it,
   into a private staging directory with a plugin-owned npm cache. The package's
   postinstall, which would rewrite global shims, never runs.
3. Requires `npm audit signatures --json` to exit zero with nothing invalid or
   missing.
4. Requires the installed tarball's integrity to equal the pinned one, and its
   resolved URL to come from the pinned registry.
5. Fetches the SLSA provenance attestation from the registry: its subject digest
   must equal that integrity, its workflow must belong to the pinned repository,
   and its build source must be the pinned commit. (agent-browser publishes from
   `refs/heads/main`, so the commit is the pin, not a tag ref.)
6. Hashes the platform binary against the pinned SHA-256, marks it executable,
   requires `--version` to report the pinned version, writes `verified.json`,
   and atomically renames the staging directory to
   `runtime/npm/agent-browser@<version>/`.

Warm starts read `verified.json`, re-hash the binary, and use it without npm or
the network; a tampered or missing binary triggers a fresh install. A lock file
serializes installs across worker processes, in-process callers share one job,
an interrupted install leaves nothing behind, and an install nobody waits on for
15 seconds is cancelled. Because a cold install or a Chrome download can exceed
the 30-second host RPC deadline, the server polls the host's `prepare` RPC, which
long-polls the shared job and reports progress, before calling `open`.

There is no fallback to another version, a `PATH` binary, or an unpinned
download. A platform without a recorded digest fails with an explicit error.

### Bumping the pin

1. `npm view agent-browser@<version> dist.integrity gitHead` gives the
   integrity and the commit; confirm the commit is the release tag's.
2. `npm pack agent-browser@<version>`, unpack it, and `sha256sum` the four
   `bin/agent-browser-<platform>` files into `runtimeRelease.artifacts`.
3. Read the release notes for changed flags or commands that `guard.ts` should
   know about, then run `npm test` and `npm run smoke` on a Linux and a macOS
   host.

## CLI and agent workflow

```sh
bb agent-browser open --machine <host-id> [--cursor] [--input-mode human|smooth|instant] [--ignore-https-errors]
bb agent-browser open --machine <desktop-host-id> --desktop <instance-id> [--tab <tab-id>]
bb agent-browser list
bb agent-browser run <session-id> [--timeout-ms <ms>] [--json] -- <agent-browser command> [args]
bb agent-browser screenshot <session-id> [--full] [--annotate]
bb agent-browser recording <session-id>
bb agent-browser preview <session-id> [--after <sequence>]
bb agent-browser stop <session-id>
bb agent-browser close <session-id>
```

Outside a thread, supply `--thread <thread-id>`. Calls from a thread cannot
reach another thread's sessions. Agents learn the workflow from the bundled
`agent-browser` skill.

`run` hands everything after `--` to agent-browser and prints agent-browser's
own output, which is already written for agents (`snapshot -i`, `click @e2`,
`fill`, `wait --text`, `batch`, `skills get core`, and so on). It exits with
agent-browser's exit code. A failing command is an ordinary result; only a
failure of the runtime itself stops the session. `--json` wraps the output as
`{text, images, exitCode, hostId}`. Timeouts run from 1 to 300 seconds, 60 by
default; a timeout exits 124 and leaves the session open, because the CLI is
only a client of the session's daemon. Runs are serialized per session. Output
is bounded to 512 KB raw and 160,000 characters, and agent-browser itself
truncates page output at 100,000 characters (`AGENT_BROWSER_MAX_OUTPUT`).

### What the session owns

Each session is one agent-browser daemon with its own socket directory, an empty
`--config` so neither the user's `~/.agent-browser/config.json` nor a project
`agent-browser.json` can change what it launches, and an environment built from
an allowlist, so stray `AGENT_BROWSER_*` variables never leak in. Relative paths
resolve in the session's `files/` directory; screenshots go to `captures/` as
JPEG at quality 70; downloads go to `files/`.

`guard.ts` refuses the agent-browser invocations that would break that
ownership, on the server and again on the host:

- lifecycle and attachment: `close`/`quit`/`exit`, `connect`, `session`,
  `profiles`, `device`, and the flags `--session`, `--namespace`, `--restore*`,
  `--cdp`, `--auto-connect`, `--provider`/`-p`, `--profile`, `--engine`,
  `--config`, `--idle-timeout`;
- the recording and stream the plugin manages: `record`, `stream`, `inspect`;
- host-level commands: `install`, `upgrade`, `doctor`, `dashboard`, `plugins`,
  `mcp`, `chat`;
- launch options that make the daemon relaunch Chrome and drop the cursor
  overlay: `--headed`, `--executable-path`, `--args`, `--extension`, `--state`,
  `--proxy`, `--user-agent`, `--ignore-https-errors`, `--ca-cert`,
  `--allow-file-access`, `--webgpu`, `--allowed-domains`. Launch options belong
  on `bb agent-browser open`, which today offers `--ignore-https-errors`.

The command must come first (`snapshot -i`, not `-i snapshot`) so it cannot hide
behind a flag's value, and the same rules apply to every entry of a `batch`.
This keeps a BB session coherent; it is not a security sandbox. agent-browser
commands such as `eval` run trusted code in the page.

### Cursor, input mode, and recording

`open --cursor` starts
`record start <session>/recordings/take-1.webm --cursor --fps 15` and defaults
the input mode to `human`; without it the input mode defaults to `instant` and
nothing is recorded. An explicit `--input-mode` wins either way.
The pointer overlay is agent-browser's: inert, in a closed shadow root in an
isolated world, hidden from accessibility snapshots, and removed with the
recording. It appears on the first pointer event in each document, so it is
absent between a navigation and the next move.

`recording` runs `record restart` into the next take and returns the finished
file's `path`, `bytes`, and `hostId`. Takes live in the session's temporary
directory on the browser host and are deleted on `close`; copy them out first
(`bb file read <path> --host <host-id> --json`, as the skill shows).

The recording costs CPU for as long as the session is open, because the recorder
encodes at a constant frame rate: about a fifth of one core for ffmpeg at 15 fps
on a busy page. Idle sessions close after five minutes. That cost is why the
cursor is opt-in: in a 25-trial agent eval, human-paced sessions took about a
quarter longer than instant ones with no difference in success (a human-mode
click takes roughly half a second to a second).

If the recording cannot start, the session opens anyway with `cursor: false` and
a `cursorDetail`, and `recording` reports the same reason. The usual cause is a
host without `ffmpeg`.

### Desktop sessions

`--desktop <instance-id>` attaches to a BB desktop app instead of launching
Chrome (find instances with `bb browser instances --host <host-id> --json`). The
plugin creates a tab in a dedicated automation profile, acquires a control lease,
and points agent-browser at BB's brokered loopback CDP endpoint through
`AGENT_BROWSER_CDP`, so the endpoint's token never appears in a process
argument list. It is removed from command output and never stored in session
records. `--tab <tab-id>` instead hands off an existing tab, granting that
profile's browsing authority including its cookies; `close` preserves a handed-off
tab and disposes plugin-created ones. Lease loss stops the session.

**`--cursor` does not work on desktop sessions yet.** BB's desktop bridge rejects
`Target.getTargetInfo` on its scoped page sessions, which agent-browser's
recorder calls, so `record start` fails there. Navigation, snapshots, clicks
(still human-paced), and screenshots all work. The plugin skips the attempt on
the blank tab, retries after the first pages load (at most twice, and quickly),
and reports the bridge's error in `cursorDetail`; once the bridge allows that
call the cursor will start without a plugin change. Desktop sessions have no
preview card either: that browser is already visible in the app's side panel,
and the bridge allows one connection per lease.

### Lifetimes

Sessions expire after 30 minutes, with five-minute idle cleanup; running
commands do not count as idle, and watching a preview does not count as
activity. Archiving, deleting, or failing a thread closes its sessions.
`close` asks the daemon to close, waits for its PID file to disappear, and
signals only a daemon that still claims the session's private socket directory.
If the host worker dies without closing, the daemon ends itself: it runs with
`AGENT_BROWSER_IDLE_TIMEOUT_MS` one minute longer than the session's idle
timeout. If the daemon dies, the next command ends the session instead of
letting the CLI silently start a fresh browser with none of the session's pages.
Server metadata persists ownership and cleanup needs; a restart closes
recorded sessions and revokes their desktop leases.

## Live preview

A local headless `open` returns a `previewDirective`,
`::agent-browser-preview{session="<session-id>"}`. The plugin's agent
instructions tell the agent to paste it once, as a standalone line. BB renders it
as a live thumbnail of the browser with the page title, location, and a Live,
Ended, or Unavailable state; the expand button opens the same live view in a
lightbox (the shared responsive drawer on compact screens), mounted once per
window so it survives timeline pagination.

Frames come from a second, read-only CDP connection that the host worker opens
to the session's own Chrome at the endpoint agent-browser reports
(`get cdp-url`, loopback only). It runs `Page.startScreencast` as JPEG at up to
about eight frames per second, 800 pixels on the long edge for the card and up
to 1280 while a lightbox asks for `size: "full"`. Because the cursor overlay is
part of the page, it is in every frame. The connection opens on demand and
closes after 15 seconds without a request; previews never enter the run queue.
The app long-polls the `preview` RPC, and a card polls only while the window is
visible and the card is expanded and on screen.

## Validation

```sh
npm install
npm run typecheck
npm test
npm run smoke
bb plugin build
```

`npm test` needs no browser. `runtime.test.ts` drives the real runtime against a
stand-in agent-browser executable that starts a detached "daemon" and writes its
PID file the way the real client does: open order and environment, desktop
attachment through the environment, cursor fallback and retry, timeouts,
cancellation, serialization, screenshots, takes, close, a daemon that ignores
close, and a daemon that vanishes. `installer.test.ts` runs the installer against
a fake `npm` and a local attestation server. `host.test.ts`, `server.test.ts`,
and `app.test.tsx` use the SDK harnesses; `guard.test.ts` and `cli.test.ts` cover
the passthrough rules.

`npm run smoke` is the real thing without a BB core: a cold install of the pinned
release from npm (signatures and provenance included), a warm resolve, then real
headless Chrome through `createRuntime`: a human-mode click while a preview
watcher collects frames, a failing command, a screenshot, a recording take, the
guard, and cleanup. `AGENT_BROWSER_SMOKE_KEEP=/some/dir` keeps the frames, the
screenshot, and the video for inspection; `AGENT_BROWSER_SMOKE_DATA` reuses an
install between runs.

## Credits

The session, host-worker, installer, and preview design comes from BB's built-in
Browser Automation plugin. agent-browser is Apache-2.0 licensed by Vercel; the
plugin installs it from npm at run time and does not redistribute it.
