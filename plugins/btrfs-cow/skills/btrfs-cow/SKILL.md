---
name: btrfs-cow
description: Use when a thread runs in a "CoW copy" environment (provider id btrfs-cow), or when choosing between worktree and copy-on-write environments on Btrfs/XFS machines.
---

# CoW copy environments

The `btrfs-cow` environment provider creates a copy-on-write copy of the
project checkout: a `btrfs subvolume snapshot` when the checkout is a
subvolume, otherwise `cp -a --reflink=always`. Either way the copy is a full,
independent checkout: its own `.git`, its own `node_modules`, and any
uncommitted changes the source had at copy time.

- The thread's branch is created in the copy with `git checkout -B`; the
  source checkout's branch at copy time is the merge base.
- Commits and file edits in the copy never affect the source checkout.
- Pushing, fetching, and PR creation work like any normal clone.
- Dependencies are already installed if the source had them; skip reinstalling
  unless the lockfile changed.
- The provider is only offered when the source and the plugin data directory
  share a reflink-capable filesystem (Btrfs, XFS, ZFS, bcachefs).

Commands (run from any machine; `--machine` names where the checkout lives):

- `bb btrfs-cow status --machine <name> <path>` shows the mode a checkout
  would get and whether snapshots can be deleted without root.
- `bb btrfs-cow convert --machine <name> <path>` turns a plain checkout into a
  subvolume so future threads snapshot it in constant time. One-time; keeps
  the path. Ask before running it on a checkout someone is actively using.

Spawn a child thread in one with:

```sh
bb thread spawn --environment-provider btrfs-cow ...
```
