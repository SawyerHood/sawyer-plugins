---
name: agent-browser
description: Use the Agent Browser BB plugin to drive a thread-owned agent-browser session with a live preview. Use for browser navigation, snapshots, clicking, forms, and verification screenshots, and, when the user wants to watch or keep a video, a visible cursor and a recording.
---

Use `bb agent-browser`. Open one session, keep its session ID, then run
ordinary [agent-browser](https://github.com/vercel-labs/agent-browser) commands
in it. Headless sessions show a live preview in the chat. When the user wants
to watch the pointer or keep a video of the work, open the session with
`--cursor`.

## Open

```sh
bb agent-browser open --machine <host-id>
bb agent-browser open --machine <host-id> --desktop <instance-id>
```

Without `--desktop` the session is headless Chrome on that enrolled host. With
`--desktop` it is a new dedicated automation tab in that BB desktop app; resolve
the instance first with `bb browser instances --host <host-id> --json`. Adding
`--tab <tab-id>` hands off an existing tab and its profile's logged-in
authority; do so only when the user asked to use that tab. Never silently
choose a different host, mode, or login profile. The CLI uses the current
thread, or `--thread <id>` outside a thread. Each session belongs to that
thread.

Options on `open`:

- `--cursor` — off by default. Paints an animated pointer and click ripple
  into the page, moves it along human-like paths, and records a video. Use it
  only when the user asked to watch the cursor or wants a recording: it keeps
  an encoder running (about a fifth of a CPU core on that host) for as long as
  the session is open, and each click takes about half a second longer.
- `--input-mode human|smooth|instant` — pointer movement. `instant` by default,
  `human` by default with `--cursor`.
- `--ignore-https-errors` — for self-signed development servers.

`open` prints the session as JSON. After `--cursor`, `cursor: false` with a
`cursorDetail` means the pointer overlay could not start, usually because
`ffmpeg` is missing on that host; the session still works, and you should tell
the user why there is no cursor. Desktop sessions cannot show the cursor or
record yet: BB's desktop browser bridge blocks a call the recorder needs, and
their `cursorDetail` says so after the first page loads. Commands and
screenshots work there as usual.

A headless `open` also returns a `previewDirective`, for example
`::agent-browser-preview{session="<session-id>"}`. Copy it into your next
message exactly once as a standalone line, before you continue working. Do not
wrap it in backticks or a code fence, and do not invent or edit the session ID.
BB renders it as a live view of that browser, which the user can expand. Desktop sessions return no directive; that browser is already
visible in the side panel.

## Run agent-browser commands

Everything after `--` goes to agent-browser unchanged, command first:

```sh
bb agent-browser run <session-id> -- open https://example.com
bb agent-browser run <session-id> -- snapshot -i
bb agent-browser run <session-id> -- click @e2
bb agent-browser run <session-id> -- fill @e3 "hello@example.com"
bb agent-browser run <session-id> -- wait --text "Saved"
bb agent-browser run <session-id> -- batch "open https://example.com" "snapshot -i"
```

### Chain steps in one call

Every `bb agent-browser run` is a round trip you pay for in time and tokens, so
put a known sequence of steps in one `batch`. Each quoted argument is a full
command; they run in order and the output shows each result. `--bail` stops at
the first failure.

```sh
bb agent-browser run <session-id> -- batch --bail 'fill @e3 "Dana Whitfield"' 'select @e5 team' 'click @e9' 'wait 800' 'snapshot -i'
```

Snapshot once, act on several refs in one batch, and end the batch with the
`snapshot -i` or `get text` you need next. Refs stay valid within a document,
so one snapshot covers a whole form. Start a new batch only where you must read
the page to decide what to do: after a navigation, or when new elements appear.
A batch can also open a page and read it: `batch 'open <url>' 'snapshot -i'`.

`run` prints agent-browser's own output and exits with its exit code; a failed
command is a normal result, not a broken session. Add `--json` before the `--`
for `{text, exitCode, hostId}` instead. `--timeout-ms` allows 1 to 300 seconds,
60 by default; a timeout exits 124 and leaves the session open.

Work in the usual agent-browser loop: `snapshot -i`, act on the `@e` refs it
printed, then check the result with a cheap `get url`, `get text`, or another
snapshot. Refs survive changes within a document and are invalidated by
navigation, so snapshot again after the page changes. For the full command
reference run `bb agent-browser run <session-id> -- skills get core --full`.

The BB session owns the browser, so these are refused: `close`, `connect`,
`session`, `record`, `stream`, `install`, `dashboard`, and flags that re-target
or relaunch the browser such as `--session`, `--cdp`, `--profile`, `--headed`,
`--args`, `--proxy`, and `--user-agent`. Relative paths, downloads, and
`localhost` refer to the browser host, not your workspace. Transfer files
explicitly.

## See the page

```sh
bb agent-browser screenshot <session-id> [--full] [--annotate]
```

This returns JSON with `hostId` and `images`, where each image has `path`,
`mimeType`, `width`, and `height`. `--annotate` numbers the interactive
elements and lists their refs in `text`. The path is in the session's temporary
directory on the browser host. Use your image-reading tool on the path when you
are on the same machine. If the browser host differs, fetch the file first
(substitute the returned path and host ID):

```sh
bb file read '<path>' --host '<host-id>' --json | node -e '
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const file = JSON.parse(fs.readFileSync(0, "utf8"));
if (file.contentEncoding !== "base64") throw new Error("Expected a binary file");
const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agent-browser-")), path.basename(process.argv[1]));
fs.writeFileSync(destination, Buffer.from(file.content, "base64"), {mode: 0o600});
console.log(destination);
' '<path>'
```

Do not print base64 bytes into the conversation. `bb agent-browser preview
<session-id>` reports the live frame's `url`, `title`, size, and `sequence`
without image bytes; it is not a substitute for `screenshot` when you need to
see the page.

## Hand back a recording

A session opened with `--cursor` records a WebM video with the pointer and
click ripples. Other sessions have no recording.

```sh
bb agent-browser recording <session-id>
```

This finishes the current take, returns its `path`, `bytes`, and `hostId`, and
keeps recording into a new take. Call it after the flow you want to show, then
copy the file out the same way as a screenshot. Add a short `wait 500` before
and after key actions when the video is for a person.

## Finish

```sh
bb agent-browser stop <session-id>
bb agent-browser close <session-id>
bb agent-browser list
```

`stop` cancels running and queued work and releases desktop control; open a new
session to resume. `close` disposes owned Chrome and plugin-created desktop
tabs while preserving handed-off tabs. Closing removes the session's
screenshots and recordings, so copy what you need first. Close sessions after
use. Five-minute idle and thirty-minute absolute expiry apply.

An unavailable backend or a failed install is an actionable setup error, not
permission to attach to a random browser. The first open on a host installs
the pinned `agent-browser` npm release into plugin-owned storage there and
verifies its signature, provenance, and digest; it needs npm and network
access, and downloads Chrome for Testing when the host has no Chrome. That can
take a minute. Later opens reuse the verified install offline. `--cursor` and
recording also need `ffmpeg` on that host. The exact pin and setup are in the
plugin README.
