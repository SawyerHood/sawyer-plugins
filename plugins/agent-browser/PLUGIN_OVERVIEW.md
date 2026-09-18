Let agents drive a real browser with [agent-browser](https://github.com/vercel-labs/agent-browser), and watch them do it. Each headless session streams a live preview into the chat. On request, a session also moves a visible pointer along human-like paths and records a video of the work.

## What you get

- A live browser card in the chat whenever an agent opens a headless session. Expand it into a lightbox sized to the window.
- An optional visible cursor. Ask the agent to show its cursor and the session opens with `--cursor`: you see the pointer glide to each target and the click ripple, with agent-browser's human-like movement. It is off by default because it keeps a video encoder running on that machine and slows each click.
- A recording of `--cursor` sessions. The agent can hand back a WebM of the flow it just ran, pointer included.
- Sessions that belong to the thread. They run on the machine you choose, close when the thread is archived, and expire when idle.
- Attachment to the BB desktop app's browser as well as headless Chrome. The cursor overlay is not available there yet.

## For agents

Agents get the `agent-browser` skill and the `bb agent-browser` command. They open a session with `bb agent-browser open --machine <host-id>`, then run ordinary agent-browser commands in it: `bb agent-browser run <session-id> -- snapshot -i`, `click @e2`, `fill`, `wait`, `batch`. `bb agent-browser screenshot` and `bb agent-browser recording` return file paths on the browser host.

## Setup

The first session on a machine installs a pinned, signature- and provenance-checked agent-browser release into plugin-owned storage there. That needs npm and network access on that machine. It downloads Chrome for Testing if the machine has no Chrome. `--cursor` sessions need `ffmpeg`; without it they still work, without a cursor. Linux (glibc) and macOS hosts are supported.
