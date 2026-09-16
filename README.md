# sawyer-plugins

Sawyer Hood's [BB](https://getbb.app) plugins, in one repository. Every plugin lives under `plugins/<id>/` as an ordinary plugin package with its own `package.json`, and `.bb/plugins.json` indexes them as a collection.

| Plugin | Directory | What it does |
| --- | --- | --- |
| Better Notes | [`plugins/better-notes`](plugins/better-notes) | An editable fork of BB’s built-in document and notes library. |
| Cascade | [`plugins/cascade`](plugins/cascade) | A scrollable, tiled layout for active BB threads. |
| Compact Nav | [`plugins/compact-nav`](plugins/compact-nav) | Borderless sidebar icon buttons with native ordering and visibility controls. |
| CoW copy | [`plugins/btrfs-cow`](plugins/btrfs-cow) | An environment provider that uses copy-on-write reflink copies instead of git worktrees (Btrfs/XFS). |
| Miku Companion | [`plugins/miku`](plugins/miku) | An event-aware Hatsune Miku companion and theme. |
| OpenRouter Inference | [`plugins/openrouter-inference`](plugins/openrouter-inference) | Thread titles, commit messages, and voice transcription from OpenRouter models, with your own API key. |
| Pokémon | [`plugins/pokemon`](plugins/pokemon) | Catch a random Pokémon every time you archive a thread, and fill out your Pokédex. |
| Quick Chat | [`plugins/quick-chat`](plugins/quick-chat) | A floating chat window for quick, projectless questions. |
| Quick Compose | [`plugins/quick-compose`](plugins/quick-compose) | A floating new-thread composer you can open from anywhere. |
| SlopCop | [`plugins/slopcop`](plugins/slopcop) | Automated GitHub issue and PR rules that dispatch BB agents. |
| T3 Sidebar | [`plugins/t3sidebar`](plugins/t3sidebar) | An inbox-style sidebar for BB threads. |

## Install

Most of these plugins are listed in the BB community marketplace, so the easiest path is the marketplace UI or `bb plugin install <id>`.

To install straight from this repository, pick one plugin directory:

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git --plugin miku
```

Or pin a semver range over that plugin's release tags:

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git@^0.6.0 --subdirectory plugins/miku --tag-prefix miku/
```

## Releases

Each plugin is versioned and tagged on its own as `<id>/vX.Y.Z` (for example `miku/v0.6.0`). Bump the plugin's `package.json` version, commit, then tag that commit with the matching prefix.

## Development

Each plugin directory is self-contained: run `npm install` inside it, then `npm run typecheck`, `npm test`, or `npm run build` as its `package.json` defines. See each plugin's README for details.

## History

These plugins were previously published from separate repositories (`bb-plugin-cascade`, `bb-plugin-compact-nav`, `bb-plugin-btrfs-cow`, `bb-plugin-miku`, `bb-slop-cop`, and `bb-plugin-t3sidebar`). Their full commit history was merged into this repository with `git subtree`.

## License

[MIT](LICENSE).
