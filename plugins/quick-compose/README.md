# Quick Compose

A BB plugin that opens a floating new-thread composer over whatever you're looking at, so you can start a thread without going to the new thread page.

- Press **Mod+Shift+L** (Cmd on macOS, Ctrl elsewhere), or run **Quick compose: new thread** from the command palette (Mod+Shift+P). The shortcut opens and closes it, and you can rebind it in Settings → Keyboard.
- The composer starts on the project you're viewing. You can still pick a different project, model, environment, or permission mode.
- Submit to start the thread. The composer closes and you stay where you are; click **Open** on the toast to jump to the new thread.
- On a thread, press **Mod+Shift+H** or run **Quick compose: hand off this thread** to start a handoff. The composer starts with an `@thread` mention of the thread you're on and reuses its environment by default. Each thread keeps its own handoff draft.
- Press **Escape** or click outside to dismiss it. What you typed is kept for next time. If you typed or picked a different project, environment, or other option, the composer comes back exactly as you left it until you submit.

## Install

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git --plugin quick-compose
```

## How it works

The window is an app overlay around BB's own new-thread composer. On submit, the plugin's backend passes the composer's request to `threads.spawn`, so the thread is created exactly as the new thread page would create it and shows up in the sidebar as usual.

The plugin adds no agent tools, CLI commands, or settings.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
bb plugin install . --yes
```
