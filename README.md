# CoW copy (bb-plugin-btrfs-cow)

A BB environment provider that gives each thread a **copy-on-write reflink copy**
of the project checkout instead of a git worktree.

On Btrfs (and XFS, ZFS, bcachefs) `cp --reflink=always` clones a directory tree
by sharing data extents. The copy is created in well under a second regardless
of size, uses no extra disk until files are modified, and carries everything
the checkout contains: the `.git` directory, `node_modules`, build caches, and
uncommitted changes. Removal is a plain directory delete.

## How it works

- `availability` reflinks a probe file from the checkout into the plugin's copy
  root on the selected machine. If that fails (tmpfs, ext4, different
  filesystem) the provider reports itself unavailable for that project and
  machine.
- `create` runs `cp -a --reflink=always <checkout> <dataDir>/copies/<pathKey>/<repo>`
  on the machine, then `git checkout -B <suggested-branch>` inside the copy.
  The checkout's current branch is reported as the merge base. Creation is
  idempotent per path key: a completed copy already on the requested branch is
  reused after a restart.
- `remove` kills processes whose cwd is inside the copy and deletes it. Only
  paths of the form `<dataDir>/copies/<key>/<repo>` are ever removed.
- Core still runs the repo's `.bb-env-setup.sh` and `.bb-env-teardown.sh`.

The source checkout must own its `.git` directory. Linked worktrees (whose
`.git` is a file) are refused because a copy would share the parent's
worktree metadata.

## Install

```sh
git clone https://github.com/SawyerHood/bb-plugin-btrfs-cow.git
cd bb-plugin-btrfs-cow
npm install
bb plugin build
bb plugin install .      # on the machine that runs the bb server
# or, without cloning:
bb plugin install git:https://github.com/SawyerHood/bb-plugin-btrfs-cow.git
```

Select **CoW copy** in the environment picker, or
`bb thread spawn --environment-provider btrfs-cow`.

## Develop

```sh
npm run typecheck
npm test                 # needs a reflink-capable $HOME; set BB_COW_TEST_ROOT to override
bb plugin dev
```
