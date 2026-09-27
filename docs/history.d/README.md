# Build history — one file per branch

Since 2026-09-26 the dated write-up of a chunk is **one new file per branch / PR in this folder**,
instead of a section appended to the tail of [`../HISTORY.md`](../HISTORY.md). `HISTORY.md` is the
frozen archive of everything up to 2026-09-26; its `## Index` table covers the archive only.

Ported from icelandicstore #355 (2026-09-18), where 51 of 60 merges had touched the tail of the one
log.

## Why

Every chunk appended to the same last lines of `docs/HISTORY.md` (and its index table). With several
sessions working in parallel worktrees, each merge made every other open branch conflict at the
tail, and resolving that cost a rebase and a fresh CI run per branch, per merge. A new file cannot
conflict with another new file.

## The rule

- **Add** `docs/history.d/YYYY-MM-DD-<branch>.md` in the branch that ships the change: the date you
  open the PR (or merge, for a local chunk), and the branch name with `/` written as `-`
  (`harvest2/lane0-history` → `2026-09-26-harvest2-lane0-history.md`). The branch name is unique per
  worktree, so two sessions on the same day cannot pick the same filename.
- **The first line is the anchor**, `<a id="<slug>"></a>`, and the next non-empty line is the
  heading, `## YYYY-MM-DD — <title>` (add ` (PR #NNN)` once the PR exists). Then the same kind of
  prose the archive carries: what shipped, why, what was measured, what is still owed.
- **The slug is unique** across the archive and every fragment (in a downstream: its own archive,
  the engine's fragments and its own), and follows the archive's habit of ending in the date
  (`harvest2-lane0-2026-09-26`). On a collision the newer **fragment** slug is renamed, never an
  archive anchor (see Downstreams).
- One fragment per branch. A follow-up branch on the same feature gets its own file.
- **Never edit `docs/HISTORY.md`** — a later correction to an archived entry goes in a new fragment
  that names the entry's anchor. Code comments that cite "HISTORY.md, 2026-09-15" or
  `HISTORY.md#some-anchor` refer to the archive and stay valid.
- **`PLAN.md` open items:** add a dated bullet (or sub-bullet); do not rewrite a long existing
  paragraph — two branches that reword one always conflict.
- `tests/unit/historyFragments.test.js` enforces the filename, a real calendar date, the anchor
  line and the heading line.

## Linking to a fragment

The rest of the recording convention is unchanged (CLAUDE.md, "Recording a chunk"): the rules a
chunk establishes go to the domain's "Rules that must hold" in `docs/ARCHITECTURE.md`, its open
items to `PLAN.md` → Status, and a feature it adds or changes lists the anchor in its
`features/<id>.md` `history:`. Only the link target moved:

| From | Link |
|---|---|
| `docs/ARCHITECTURE.md`, `docs/API.md` (and any file in `docs/`) | `[slug](history.d/2026-09-26-harvest2-lane0-history.md#harvest2-lane0-2026-09-26)` |
| `PLAN.md` (repo root) | `[slug](docs/history.d/2026-09-26-harvest2-lane0-history.md#harvest2-lane0-2026-09-26)` |
| `features/*.md` body | `../docs/history.d/<file>.md#<slug>` |
| `features/*.md` frontmatter | `history: [harvest2-lane0-2026-09-26]` — the bare slug; the archive and the fragments are one namespace |

`tests/unit/architectureIndex.test.js` checks that every `HISTORY.md#…` link and every
`history.d/<file>.md#…` link (inline, titled or reference-style, relative to the linking file) in
every `.md` under `docs/` and `features/`, plus `PLAN.md`, `README.md` and `CLAUDE.md`, resolves —
the file exists and the anchor is in that file (links inside code spans are examples and are
skipped) — and that no slug appears twice across the archive and
the fragments. `tests/unit/featureRegistry.test.js` resolves `history:` slugs against the same union
(`tests/lib/historyAnchors.js`).

## Downstreams

Same rules as `docs/ENGINE-SYNC.md` §6 (History):

- **The fragments are engine-owned** and arrive in every downstream as new files by
  `git merge upstream/master`, so they do not conflict. A downstream adds its own fragments here
  too; its branch names keep the filenames apart.
- **A downstream's own `docs/HISTORY.md` archive stays its own.** A downstream that keeps one
  (rekstrarkerfid does) takes ITS side on a conflict there, and lists `docs/HISTORY.md` in its
  `engine.json` `productPaths` so the merge does that without asking. "Never edit the archive"
  above means: never append to it — in the engine or in a downstream.
- **A slug collision** after a sync (the parity tests fail on a repeated `<a id>`) is fixed by
  renaming the downstream's own fragment slug, and its links, never an archive anchor — old links
  and code comments cite those.

## Reading it

Filenames sort chronologically, so:

```bash
ls docs/history.d/                    # the index, oldest first
cat docs/history.d/2026-*.md          # the whole log since the cut-over
grep -rl "harvest" docs/history.d/    # the entries on a topic
```
