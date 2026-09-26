<a id="harvest2-lane0-2026-09-26"></a>
## 2026-09-26 — Harvest 2, lane 0: history fragments, a review pass per chunk, the deployed-environment walkthrough

The first lane of Harvest 2 (generic icelandicstore work up to `ice@941cf51d`, ported into the engine
in lanes 0–9; Halli approved the scope and the CLAUDE.md rule changes on 2026-09-26). Lane 0 changes
how work is recorded and reviewed, so the lanes after it land on the new rules. Branch
`harvest2/lane0-history`. Ported from ice `459dba6` (#355), #363 (the rule only) and #128 (the doc).

**Why.** Every chunk appended a section to the tail of `docs/HISTORY.md` and a row to its index
table. With several sessions in parallel worktrees (the 2026-09-24 harvest ran lanes 1–3 at once),
each merge made every other open branch conflict at the same few lines, and resolving it cost a
rebase and a fresh CI run. Icelandicstore measured the same thing on 2026-09-18 (51 of 60 merges
touched the tail) and moved to one file per PR. A new file cannot conflict with another new file.
The chunk-F harvest (2026-09-24) deferred this port because it changes a CLAUDE.md rule; that was
chunk F's open item (d), settled here.

**What changed.**
- **`docs/history.d/`**: one fragment per branch, `YYYY-MM-DD-<branch, / as ->.md`. The engine's
  fragments keep the archive's linkability: the first line is the `<a id>` anchor, the next non-empty
  line is `## YYYY-MM-DD — <title>`, and the slug is unique across the archive and every fragment.
  The README says how ARCHITECTURE, API, PLAN and `features/*.md` link to one.
- **`docs/HISTORY.md` is frozen**: a banner at the top; its `## Index` covers the archive only. Old
  `HISTORY.md#…` links and code comments stay valid.
- **Tests.** `tests/lib/historyAnchors.js` reads the archive and the fragments as one anchor
  namespace. `architectureIndex.test.js`: the index-table check is archive-only; a new check fails
  on a slug repeated across the two; every `HISTORY.md#id` and `history.d/<file>.md#id` link in
  ARCHITECTURE, PLAN and API must name an existing file that holds the anchor. The old check only
  asked whether the anchor existed anywhere. `featureRegistry.test.js` resolves `history:` slugs
  against the union. `historyFragments.test.js` (ported from ice) checks the filename, a real
  calendar date, the anchor line and the heading line.
- **Instructions reworded**: CLAUDE.md's "Recording a chunk" and doc map, PLAN.md's Status
  preamble, README.md, ARCHITECTURE.md's preamble and domain 20, `.claude/commands/status.md`, and
  the `ci-skipped.yml` comments. Links to archive anchors (MIGRATIONS.md, ENGINE-SYNC.md, the
  scene-engine heading in CLAUDE.md) were left as they were.
- **Review before merge** (ice #363): CLAUDE.md Project rules now say every chunk gets a review pass
  (`/code-review` or the `invariant-reviewer` agent), and its findings are fixed on the branch
  before it merges. The old "Halli reviews history post-hoc" still holds on top of that.
- **Deployed-environment walkthrough** (ice #128): a new section in `docs/TESTING.md`. Exercise each
  write path and read back what was stored ("quoted vs booked"). It maps that rule onto the
  engine's surfaces: leads, signup, invoices (never on a live ledger), commission, seller
  publication, change requests / MCP, uploads, settings, the hidden shop. It also has the
  three-part page verdict, the deployment checks and the harness traps.

**Trimmed.** Two CI parts of ice #355 were left out. The `deploy.yml` sanity job was already
handled by chunk F: ice deploys TEST on a green main, and the engine deploys by dispatch. The
removal of the `main-gate` tree-match step does not apply, because the engine's `ci.yml` has no
`main-gate`. Ice's `migrationNames.test.js` shape guard is out too: `migrationSet.test.js`
already pins the engine's two-array names (shape, uniqueness, strictly increasing). Ice's per-PR `CHANGELOG.md` freeze is not
ported, because `build-manifest.js` reads the engine's CHANGELOG at release time.

**Owed / for the next sync.** Icelandicstore already has a `docs/history.d/` with its own README,
and its fragments open with the `##` heading, not an anchor. When ice next merges the engine, the
README conflicts and the engine's `historyFragments.test.js` fails on ice's fragments. The graft
must either add an anchor line to each ice fragment or keep ice's own README and test
(product-owned there). Halli and Orri pick the window (icelandicstore business first).
