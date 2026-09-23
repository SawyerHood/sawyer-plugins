# Sawyer Sidebar

bb's built-in sidebar thread list, vendored into a plugin so it can grow features bb does not ship. It keeps everything the built-in list does: pinned threads, custom sections, project, machine, and chronological organization, nesting, drag to reorder, inline rename, and jump shortcuts.

What it adds:

- **Provider icons.** Each thread row starts with its agent provider's icon (Claude Code, Codex, and so on), drawn from the same provider directory bb's pickers use.
- **Detailed mode.** A setting that turns each row into a three-line card in the style of t3code: project with the thread's status in the upper right, then the title, then the branch or pull request with the machine name and provider icon. Turn it on under **Settings → Plugins → Sawyer Sidebar**, or with `bb plugin config sawyer-sidebar set detailedRows true`.

## Install

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git --plugin sawyer-sidebar
```

Then pick **Sawyer Sidebar** as the thread list under **Settings → Appearance**. Pick **Thread list** there, or disable this plugin, to go back to bb's own list.

On first load the plugin copies your layout (organization, sort, section order, collapsed groups) from bb's UI preferences. After that it keeps its own copy, which `bb sawyer-sidebar prefs` reads and changes.

## How the code is laid out

| Path | Owner |
| --- | --- |
| `app/`, `shared/`, `app.tsx`, `server.ts`, and their tests | Vendored from bb's `plugins/thread-list` |
| `vendor/<package>/` | The parts of bb's `@bb/*` workspace packages the list uses, with the packages' `src/` layout |
| `vendor/MANIFEST.json` | The bb commit the copy came from, and every vendored file |
| `patches/sawyer.patch` | This plugin's edits to vendored files |
| `features/` | New code. The vendoring script never touches it. |

Keep changes to vendored files small: put feature code in `features/`, and change vendored files only where they must call it.

## Updating from bb

`scripts/vendor-bb-sidebar.mjs` does the copy. It follows each `@bb/*` import to the file that declares the symbol, so only about 60 of bb's internal files are vendored instead of whole packages. It points `vendor/shared-ui/components/ui/icon.tsx` at the SDK's `experimental_Icon`.

Update to a newer bb:

```sh
# in a bb checkout with `pnpm install` done, at the commit you want
node scripts/vendor-bb-sidebar.mjs --bb ~/projects/bb
```

That replaces every vendored file, then applies `patches/sawyer.patch`. If the patch no longer applies, the script stops. Make the edits again by hand, then save the patch as described below.

After editing a vendored file, save the change into the patch. Run this with the bb checkout at the commit in `vendor/MANIFEST.json`:

```sh
node scripts/vendor-bb-sidebar.mjs --bb ~/projects/bb --save-patch
```

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
bb plugin install . --yes
```
