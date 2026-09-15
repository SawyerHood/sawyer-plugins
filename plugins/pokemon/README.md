# Pokémon

A BB plugin inspired by the Pokémon tool at Facebook: every time you close out a piece of work, you catch a Pokémon.

- **Archive a thread** and a random Pokémon appears in the corner of the screen. A Poké Ball wobbles, pops open, and the Pokémon comes out.
- Every one of the 1,025 species in the national Pokédex can appear, and duplicates count, so the Pokédex tracks how many of each you have.
- Click the card, or open **Pokédex** in the sidebar, to see your progress, your recent catches, and a grid of every species. Pokémon you haven't caught yet show up as silhouettes.
- Select a Pokémon to read its Pokédex entry: artwork, genus, types, flavor text, height, weight, abilities, habitat, base stats, its cry, and the threads you caught it from.

## Install

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git --plugin pokemon
```

## How it works

The plugin listens for BB's `thread.archived` event. Each top-level visible thread earns one catch, the first time it's archived. Unarchiving and archiving it again doesn't earn another. Archiving a parent also archives its children, but only the parent earns a catch. Hidden plugin threads, such as quick chats, don't earn any.

The species list comes from [PokeAPI](https://pokeapi.co). The server refreshes it weekly. The first time a species is caught, the server fetches its entry and caches it in the plugin's SQLite database, so PokeAPI only gets a couple of requests per new species. Sprites, artwork, and cries load from PokeAPI's GitHub-hosted assets. If PokeAPI has never been reachable, catches still work from national dex numbers 1–1025, and entries load once PokeAPI is back.

Entries for Pokémon you haven't caught stay locked, and search only matches the names of Pokémon you've caught, so nothing is spoiled.

The catch card sits in the top-right corner on desktop, clear of BB's "Thread Archived" toast. On narrow screens it rises from the bottom. It dismisses itself after nine seconds and pauses while you hover it.

The plugin adds no agent tools, CLI commands, or settings.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
bb plugin install . --yes
```

Pokémon and all related names are trademarks of Nintendo, Creatures Inc., and GAME FREAK inc. This plugin is not affiliated with them. Data comes from PokeAPI.
