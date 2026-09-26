<a id="test-db-followups-2026-09-26"></a>
## 2026-09-26 — Test-DB hygiene follow-ups: every test database owned by its run, `.wt/` ignored, engine-sync cleans up after itself

Halli approved this on 2026-09-26 ("Implement all findings and fixes"), after
[test-db-hygiene-2026-09-26](2026-09-26-feat-test-db-hygiene.md#test-db-hygiene-2026-09-26)
merged as `5c7c590`. Branch `chore/test-db-hygiene-followups` here, plus
`chore/engine-sync-cleanup` in site-factory (`8fc0183` on its main).

**Engine (this repo).**
- **The demo-reset test owns its database.** `tests/integration/demoReset.test.js`
  created `demo_reset_<pid>_test` itself and dropped it in `afterAll`, so a
  killed run leaked a name no teardown or sweep owned. It now takes
  `createExtraTestDb('demo')`: `<product>_<branch>_w<N>_demo_test`, labelled,
  inside the run's pattern, so the teardown and the next sweep drop it. The
  brief proposed the suffix `demoreset`; that name would be refused — the
  reset's guard (`server/services/demoReset.js`) wants "demo" as a WORD
  (`(^|[_-])demo([_-]|$)`), and `_demoreset_` is not. `DEMO_DATABASE_NAME`
  still equals the connected database, and `allowTestDatabase` still admits
  the `_test` name for this test only. A new assertion pins both.
- **Every database creator was inventoried** (`CREATE DATABASE`, `createdb`,
  `TEMPLATE` across tests, scripts, e2e): globalSetup, `createExtraTestDb`
  and `e2e/global-setup.js` were already owned. The sweep's own integration
  test creates `zzsw<pid>_…` names on purpose outside every product prefix (it
  runs the real sweep, which must not meet a real run's databases), so nothing
  owned them either: its `beforeAll` now drops any `zzsw<pid>_…_test` whose
  pid is dead and that no session holds, and a test covers it.
  `books-replay.js` (`orangesmiley_replay`) and the dev database are the
  operator's, not test databases. The table is in `docs/TESTING.md`.
- **`.wt/` is gitignored** — the estate's sync/graft worktree folder
  (proposed in LESSONS.md 2026-09-25, when an unlisted `.wt/` in rekstrarkerfid
  was read as stray files). It reaches the downstreams by engine-sync.
- `.claude/commands/engine-sync.md` and `docs/ENGINE-SYNC.md` §10 describe the
  new site-factory behaviour below.

**site-factory.**
- **`engine-sync.js --cleanup <date>`** — after the PR is merged or closed:
  refuses a worktree with a sync in progress or tracked changes (`--force`),
  fetches origin, unlinks a `node_modules` junction (`cmd /c rmdir`; a
  recursive delete that follows it empties the source), `git worktree
  remove`, `git branch -d` on the `engine-sync/<date>[-N]` branches git calls
  merged (never `-D`), then the downstream's `npm run test:db:clean -- --gone
  --yes` when its `drop-test-dbs.js` knows `--gone` (skipped with a note
  before the downstream has synced this hygiene). `--dry-run` plans. The sync
  prints the command at the end. Chosen over "automatic after merge": the
  script never pushes or watches PRs, so the operator runs it once the PR is
  done.
- **`TEST_PG_URL` pass-through.** A `.wt/` worktree has no `.env`, so its
  `npm run test:ci` would have derived its databases on DATABASE_URL's server
  (`:5432`). The verification now gets `TEST_PG_URL` (+ `TEST_PG_DATA`) from
  `--test-pg-url`, the environment, the downstream's `.env` or the engine
  checkout's `.env` (`ENGINE_CHECKOUT`, default `../orangesmiley`). A sync that
  would run tests with none found is refused before any side effect
  (`--allow-main-pg` overrides); a `TEST_PG_URL` on `:5432` is always refused.
  `TEST_DATABASE_URL` in the environment stays an explicit pin. `--cleanup`
  uses the same resolution.
- `--worktree` adds `/.wt/` to `.git/info/exclude` — immediate for a
  downstream whose `.gitignore` predates the engine's line.
- **Scaffold.** It already wrote `engine.json` `product` = `--name`, so a
  scaffolded product gets its own test-DB prefix. New: it refuses a name whose
  prefix collides with the engine's product or any product in
  `engine-registry.json` (equal slugs, or one is the other plus `_…` — `rk`
  and `rk-shop` would both read as `rk_` names), and adds `.wt/` to the
  project's `.gitignore` for a base older than today.
- The npm calls pass one command string (Node 24's DEP0190 warned on an argv
  with `shell: true`). `cmd /c rmdir` refuses a path that carries a cmd
  metacharacter (`" % ^ & | < > !`) — unlink such a junction by hand.

**Review pass** (the `invariant-reviewer` agent on both diffs). Engine: every
invariant holds; the demo database meets all four clauses of the reset guard.
Fixed on the branch: (A1) `dropOrphans` leaves a set labelled by another host
(a pid proves nothing across hosts) — tested. Won't fix: (A2) `PLAN.md`'s
parent bullet and `tests/unit/workerDb.test.js` still show `demoreset` as an
example suffix (the new sub-bullet corrects the plan; the unit test's suffix
never meets the demo guard); (A3) the scaffold does not reserve `zzsw` as a
product id (no product is named that).

site-factory findings **still open** — `8fc0183` was committed and pushed
before they were fixed, so they are owed in a follow-up there:
- (B1, medium) `--cleanup` removes the worktree and `git branch -d`s the
  branch without checking that the PR is merged: a branch pushed with
  `push -u` counts as merged against its own upstream, so an open PR's
  branch goes too (the remote copy survives; nothing is lost for good, but
  the promise is "only merged work"). Fix: after the fetch, require
  `git merge-base --is-ancestor <branch> origin/<default>` before the
  worktree AND the branch step (`--force` for a squash merge), and add a
  smoke case with a pushed, unmerged branch. The comment above the branch
  step claims the opposite and must be corrected.
- (B2) A `TEST_DATABASE_URL` in the environment skips the `:5432` refusal and
  satisfies the gate; with `--test-pg-url` also given, the child still gets
  `TEST_DATABASE_URL`, which the engine prefers, so the flag is silently
  ignored. Fix: refuse `:5432` for it too, and refuse (or strip) the
  combination.
- (B3) `--cleanup`'s database step runs `--gone --yes` on DATABASE_URL's
  server when no `TEST_PG_URL` is found; make that a dry run (no `--yes`)
  unless `--allow-main-pg`.
- Nits: `--cleanup <date>-N` finds no worktree (the path never carries `-N`);
  the `:5432` refusal also fires under `--no-tests`; the printed `--repo`
  path is unquoted; the scaffold's prefix check does not run under
  `--dry-run`.

**Tests.** Engine: lint, `check:i18n`, `test:unit` and the full `npm test`
on the throwaway server (counts in the merge report). site-factory:
`npm test` — both smoke suites green, with new checks for the resolution
order, the `:5432` refusal, the test-server gate, `--worktree` + the exclude,
and `--cleanup` (no date, dirty, dry run, a junction whose source survives,
the merged branch deleted, `test:db:clean -- --gone --yes` receiving
`TEST_PG_URL`, the skip on an old downstream, the refusal in the engine), plus
the scaffold's prefix clash and rollback.

**Not done / owed.**
- No real downstream sync was run with the new flags (the smoke suite drives
  them on mini repos). The first real `--cleanup` is the next engine-sync.
- The `--legacy --sweep` pass on `:5432` after each downstream syncs
  (unchanged from the parent entry).
