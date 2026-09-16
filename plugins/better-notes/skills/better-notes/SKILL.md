---
name: better-notes
description: "Read, edit, or save documents in BB Better Notes vaults, including documents supplied through Better Notes mentions."
---

# Better Notes

Better Notes is the user's filesystem-first document library. Documents can live on
the primary machine or another connected host, but the `bb better-notes` command
handles that routing through named vaults.

## Access documents

Start with the smallest useful lookup:

```sh
bb better-notes vaults --json
bb better-notes list --vault <vault-id> --json
bb better-notes read <path> --vault <vault-id>
```

Use the path and vault exactly as returned. Paths are relative to the vault;
do not guess an absolute host path or inspect the vault outside `bb better-notes`.

## Better Notes @-mentions

A Better Notes mention resolves at send time and appears in agent context as a
`Better Notes document (<vault>/<path>)` block. Treat that block as user-provided
source material from their document library:

- Read and use its current contents even if the prompt only says “this” or
  “the attached doc.”
- Preserve its meaning and distinguish its claims from your own inference.
- Do not rewrite the mentioned document unless the user asks you to change it.
- When your answer refers the user back to it, emit a Better Notes directive rather
  than an opaque filesystem path.

## Create and update documents

Better Notes is a good destination for durable plans, specifications, write-ups, and
HTML artifacts the user should be able to reopen.

```sh
bb better-notes pull plans/release-plan.md --vault personal --into ./better-notes-work
# Edit ./better-notes-work/plans/release-plan.md with normal file tools.
bb better-notes status ./better-notes-work --diff
bb better-notes push ./better-notes-work
```

`bb better-notes status` exits 0 when no changes exist. It exits 4 when it finds
changes that the output describes. Exit 4 is a successful status result.
Review that output, then run `bb better-notes push` as a separate command. Do not
connect the status and push commands with `&&`.

Pull a folder subtree with `--folder`, or the whole selected vault with
`--all`:

```sh
bb better-notes pull plans --folder --vault personal --into ./better-notes-work
bb better-notes pull --all --vault personal --into ./better-notes-work
```

Always edit the pulled files with ordinary workspace tools, then run `status`
before `push`. The manifest in `.bb-better-notes-state.json` records stable vault paths
and remote SHA-256 versions; do not edit it. Pull and push fail closed when both
the local and vault copies changed. Resolve the content manually, then pull or
push again. `push --dry-run --diff` previews without writing.

Local file and empty-directory deletions are ignored by default. Only use
`push --delete` when the user explicitly asked to delete the corresponding
vault paths. A pulled folder root is intentionally retained; pull its parent or
the whole vault to remove that folder. Binary assets round-trip with their
original bytes. If state is malformed, preserve the directory for recovery and
pull into a new clean `--into` directory.

The direct `write`, `mkdir`, `move`, and `remove` commands are deprecated. Do
not use them for agent edits; they remain temporarily available only for
backward compatibility.

Use Markdown for documents and plans. Use a self-contained `.html` file for a
visual artifact or interactive report; relative assets can live beside it.
Only write into Better Notes when the user asks to create, save, store, or update
something there.

## Link documents in responses

Emit this leaf directive on its own line:

```md
::better-notes{vault="personal" path="plans/release-plan.md" title="Release plan"}
```

`vault` and `path` are required. Include a short human-readable `title` when
known. The rendered card opens an editable, autosaving document in the thread
side panel; its secondary action opens the full Better Notes editor. Use the directive for both
Markdown documents and full HTML artifacts.
