---
name: btrfs-cow
description: Use when a thread runs in a "CoW copy" environment (provider id btrfs-cow), or when choosing between worktree and copy-on-write environments on Btrfs/XFS machines.
---

# CoW copy environments

The `btrfs-cow` environment provider creates a reflink copy of the project
checkout with `cp -a --reflink=always`. The copy is a full, independent
checkout: its own `.git`, its own `node_modules`, and any uncommitted changes
the source had at copy time.

- The thread's branch is created in the copy with `git checkout -B`; the
  source checkout's branch at copy time is the merge base.
- Commits and file edits in the copy never affect the source checkout.
- Pushing, fetching, and PR creation work like any normal clone.
- Dependencies are already installed if the source had them; skip reinstalling
  unless the lockfile changed.
- The provider is only offered when the source and the plugin data directory
  share a reflink-capable filesystem (Btrfs, XFS, ZFS, bcachefs).

Spawn a child thread in one with:

```sh
bb thread spawn --environment-provider btrfs-cow ...
```
