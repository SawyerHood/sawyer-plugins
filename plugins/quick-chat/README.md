# Quick Chat

A BB plugin that gives you a floating chat window for quick questions that don't belong to a project.

- Press **Mod+Shift+K** (Cmd on macOS, Ctrl elsewhere) to open or close it from anywhere in BB.
- Or run **Quick chat: open** or **Quick chat: new chat** from the command palette (Mod+Shift+P), or click the chat icon in the sidebar footer.
- Drag the window by its title bar. It stays anchored to the nearest corner, so resizing BB keeps it the same distance from those edges, and dropping it near an edge locks it flush. Double-click the title bar to send it back to the bottom-right corner.
- Pick up a recent chat from the list above the composer.
- Click **Open as thread** to move a chat into the sidebar as a normal thread.

## Install

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git --plugin quick-chat
```

## How it works

The window is an app overlay. New chats use BB's own new-thread composer, which starts on **No project** so each chat gets a personal workspace. You can still pick a project, model, or permission mode there. Once a chat starts, the window shows BB's `ThreadChat`, the same compact chat that side chats use.

Quick chats are hidden threads created by this plugin, so they stay out of the sidebar. **Recent chats** lists the 50 most recent hidden chats that aren't archived. **Open as thread** makes a chat visible and opens it, which removes it from the quick chat list.

The chat you had open is remembered per browser, so reopening the window brings it back.

The plugin adds no agent tools, CLI commands, or settings.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
bb plugin install . --yes
```
