# Test tiers — run the right suite for the change

_Introduced 2026-08-24 (Halli's ask: a 1-line prod fix must not cost a full-suite run). The tiers change the **inner loop**; the merge gate is unchanged — every chunk still merges only with the FULL suite green, and CI (`test:ci`) still runs everything. Test counts below were re-measured 2026-09-11 — the unit and smoke tiers were RUN that day, the full and e2e suites were counted statically (see "Measuring the suite"); the timings are still the 2026-08-24 dev-machine figures._

## The tiers (timings measured 2026-08-24 on the dev machine)

| Command | What | Size / time | DB |
|---|---|---|---|
| `npm run test:unit` | All of `tests/unit/` via `jest.unit.config.js` — no globalSetup (no DB drop/migrate), parallel workers | 1283 tests at runtime (978 declared in 67 files — `.each` tables expand), **~8 s** | none |
| `npm run test:smoke` | Critical-path integration specs: auth, security (CSRF/RBAC/headers/envelope), shop, contact (lead capture) | 112 tests at runtime (110 declared), **~28 s** | yes |
| `npm run test:hotfix` | unit + smoke, in that order | **~36 s** | yes |
| `npm run test:related -- <files…>` | Jest picks every test that (statically) depends on the named source files | varies — see caveat below | maybe |
| `npm test` | Everything (unit + all integration) in **4 parallel Jest workers, one database each** (`jest.config.js` `maxWorkers: 4`; `npm test -- --runInBand` for serial) | 4251 tests at runtime in 213 suites, **~45 s** on the local test cluster with DELETE-based cleanup (2026-09-26; ~6.5 min with TRUNCATE — see "TRUNCATE vs DELETE" below) | yes |
| `npm run test:e2e:smoke` | Playwright: auth, navigation, business-routes | 33 of the 178 | yes |
| `npm run test:e2e` | Full Playwright suite (one `chromium` project) | 178 declared tests in 26 spec files | yes |

**`test:related` caveat** (measured 2026-08-24, serially on one shared database — before the per-worker split below; the absolute times are stale, the shape of the argument is not): for a *leaf* file (a util, a client script) the related set is small and fast. For a *core* file required by `app.js`'s route tree (services, models, middleware), the related set is most of the integration suite — ~6.7 min for `discountEngine.js` (1201 tests). That is the true blast radius, but locally it defeats the purpose: for core-file fixes run `test:hotfix` and let CI's full run be the wide net.

## The hotfix workflow (production bug)

1. **Reproduce as a failing test first** — in the tier where it belongs (a controller bug → integration spec; pure logic → unit).
2. Fix it.
3. Run `npm run test:hotfix`; add `npm run test:related -- <every file you touched>` when the touched files are leaf modules (see the caveat above — for core files, hotfix + CI is the right pair). Total cost ≈ one minute.
4. Push the branch — CI runs the full suite with coverage exactly as before. CI green is the **merge** gate; nothing deploys from CI in this repo (`deploy.yml` is `workflow_dispatch` only — see `docs/DEPLOYMENT.md`). The tiers only buy you a fast, high-confidence local loop.
5. If the fix touched auth, payments, RBAC, migrations, or the error envelope: run the full local suite anyway before pushing. Those surfaces are why the smoke tier exists, but they deserve the whole net.

## Rules

- **The smoke list is per-instance.** It names this instance's revenue/security-critical paths. When porting this scheme: icelandicstore's list should be auth, security, shop/orders, adminBookkeeping + the Stripe webhook specs — not `contact`. Keep the list short enough to stay under ~30 s; it is a tripwire, not a safety net.
- **A prod bug that escaped the suite earns a permanent test** in the tier that would have caught it fastest — and if that test is critical-path, it joins the smoke list.
- **Never delete inherited specs** (stack invariant: adapt, don't delete). Tiering reorganizes when tests run, never whether they exist.
- `jest.unit.config.js` derives from `jest.config.js` — config drift between them is a bug. New unit specs must stay DB-free; a unit spec that needs Postgres belongs in `tests/integration/`.
- **Playwright boots two servers on one database** (`playwright.config.js` `webServer` array, since 2026-09-23): the main one at `E2E_PORT` runs the instance defaults (two-factor enrolment `optional`); a second at `E2E_REQUIRED_PORT` (default `E2E_PORT + 1`) runs `security.mfa.enrolment = required` for `e2e/admin-totp-enrolment.spec.js`, which points at it with `test.use({ baseURL: process.env.E2E_REQUIRED_BASE_URL })`. A spec that needs another per-INSTANCE mode gets a server the same way — never a per-request test switch in production code. Check both ports are free before a local run.
- **Engine tests read the product identity, never a brand literal** (`clientConfig.identity` server-side, `public/js/utils/identity.js` client-side, `e2e/lib/identity.js` in Playwright — the seam of 2026-09-22). A downstream that sets its `identity` block in `config/client.json` runs the engine's suites unchanged.

## The feature gate — suites of a hidden feature skip, never get deleted (2026-09-22)

A downstream product hides, disables or forks engine features (LedgerLink has no company site; rekstrarkerfid no seller area). Its graft PRs used to `describe.skip` the engine's suites by hand, which re-conflicts on every sync. Instead the product records the fact once in `features/local.json` — `{ "public-site": { "status": "hidden", "note": "…" } }` — and the gate derives the skip:

- `tests/lib/featureGate.js` is the core: it reads `features/local.json` and the feature registry (`scripts/features-index.js`), maps a suite file to its feature through the registry's `paths` (so the spec → feature mapping is never hand-kept), and answers `gate(featureId)` / `gateForSpec(file)` → `{ skip, status, reason }`. A feature is gated when its local status is `hidden`, `disabled` or `forked`, or when it belongs to ANOTHER product (`features/<other>/`, inert here). An unknown id never skips, so a typo cannot silence a suite.
- A feature whose registry `flag` resolves to `false` in this instance's client config (self-update: `modules.selfUpdate.enabled`) is gated as `disabled` too (identity-seam-2): its suites assert the ON behaviour, so a product that ships the module off does not go red. A suite that tests the OFF state (`selfUpdateDisabled`, `systemChangesGate`) forces the flag itself and does not shadow `describe` through the gate.
- Every engine e2e spec starts with `const { gateSpec } = require('./lib/featureGate'); gateSpec(test, __filename);` (`e2e/lib/featureGate.js` wraps `test.skip(condition, note)`). `skipUnless(test, 'seller-publication')` gates one describe.
- Jest suites a product may not run shadow the global: `const describe = describeForSpec(__filename);` — a `describe.skip` whose block name carries the note. Used by the os-owned `salesGuidesServicesPage` / `salesGuidesD001` suites (foreign on any other product) and `sellerArea` (the `seller-publication` feature).
- In the engine `local.json` is empty and every spec runs — `tests/unit/featureGate.test.js` pins that (only where `engine.json.role` is `engine`; the "every suite maps to a feature" half runs everywhere), and exercises a temp `local.json` that hides `public-site`. The skipped tests show in the report with the note, so a downstream's coverage of the engine is visible, not silent.

## The visitor default — suites assert the resolved locale, never Icelandic (2026-09-23)

An engine suite that reads an API string or a redirect target takes the expected value from `tests/lib/locale.js` (`e2e/lib/locale.js` re-exports it for Playwright): `PUBLIC_DEFAULT_LOCALE` is what `server/config/i18n.js` resolved (`identity.locale.publicDefault` under the env var), `tx(key, params)` is the server table's exact string in that locale, `tClient(key)` the SPA table's, `localePrefix()` the `/is` of a redirect. Assertions stay exact — `toBe(tx('errors.auth.invalidCredentials'))`, never `toMatch(/lykilorð/)` and never `toBeTruthy` — so the same suite passes in a downstream whose visitor default is `en`. Where a test deliberately exercises both locales it names both; the party route's `/is/` is a literal because the route is locale-locked. A pin about THIS repo (the committed `client.json` equals the schema defaults, the product overlays are empty) is gated on `engine.json.role`; a pin about the ENGINE compares `defaults()` or a temp `client.json`.

## Hunting an intermittent failure

Since 2026-09-02 each Jest worker has its own database (see the next section),
so suites in *different* workers cannot see each other's rows. Within a worker
suites still run serially, and Jest assigns suites to workers by cached
duration, so a suite's *neighbours inside its worker* change between runs —
which is how an order-dependent test still fails "one run in three" with no
code change (LESSONS.md 2026-08-27; that entry predates the per-worker split,
when every suite shared one database).

1. **Capture the whole run, then grep.** `npm test *> jest.log` in PowerShell.
   Trimming the stream (`Select-Object -Last N`) keeps the summary and throws
   away the `●` block that names the test.
2. **Ask Postgres what happened.** `C:/Program Files/PostgreSQL/17/data/log/postgresql-*.log`
   holds every server-side error, days back. If the failing run's errors match a
   passing run's exactly, the failure was an assertion, not the database — that
   alone rules out deadlocks, exhausted connections and constraint violations.
   Run boundaries show up as bursts of "could not receive data from client".
3. **Force the order once you have a suspect pair.** A custom sequencer that
   sorts by an env var turns an eight-minute lottery into a 90-second repro:

   ```js
   // ordered-sequencer.js
   const Sequencer = require('@jest/test-sequencer').default;
   const path = require('path');
   module.exports = class extends Sequencer {
     sort(tests) {
       const order = (process.env.TEST_ORDER || '').split(',').map(s => s.trim());
       const at = t => (order.indexOf(path.basename(t.path)) + 1) || 999;
       return [...tests].sort((a, b) => at(a) - at(b));
     }
   };
   ```

   ```bash
   TEST_ORDER="booksExpenses.test.js,booksReports.test.js" npx jest --testSequencer ./ordered-sequencer.js tests/integration/booksExpenses.test.js tests/integration/booksReports.test.js
   ```

4. **Fix the dependency, not the symptom.** No retries, no raised timeouts: make
   the assertion independent of what the previous suite left behind.

   Watch for **cumulative** figures. A balance sheet as at a date and a ledger's
   opening balance include every earlier year, so a suite's "own year" does not
   protect them. `booksReports` failed whenever `booksReplay` (2017 share
   capital, 500.000 on 1900 / 3100) ran before it in the same worker — CI run
   34763226590. Compare cumulative figures with the journal as it stands.

## Hunting a CI-only e2e timeout

Playwright specs that pass locally and time out on CI (fixed 2026-09-13:
`accounts.spec.js:46` and `leads.spec.js:26` had failed on almost every master
run since 2026-09-08; `admin-surface.spec.js:70` sometimes).

1. **Read the traces, not the error.** A red run uploads `playwright-report`
   with the first retry's trace. `gh run download <run> -n playwright-report`;
   each `data/*.zip` holds `test.trace` (every step with start and end times)
   and `*-trace.network`. Per-test durations for the whole run are in the zip
   embedded in `index.html` (`<template id="playwrightReportBase64">`). Those
   showed no hang: each full `page.goto` cost 3–4 s (the router imports every
   view module eagerly — 160 JS requests), a simple click up to 2.5 s, and the
   two flows simply ran 30–37 s.
2. **Starve the machine locally to reproduce.** Pin the whole run (server,
   workers, browsers — children inherit it) to one or two cores from
   PowerShell. The inner double quotes need the single-quoted string:

   ```powershell
   cmd /c 'start "e2e" /affinity 1 /wait /b cmd /c "set E2E_PORT=3011&& set CI=true&& npx playwright test --retries=0 --workers=4"'
   ```

   On one core, 4 workers summed 1670 s of test time in 7.3 min and 2 workers
   822 s in 7.0 min: same wall clock, every test twice as long.
3. **Workers follow the CPUs on CI.** This repo is private, so GitHub runs it
   on the 2-vCPU Linux runner. `playwright.config.js` sets CI workers to
   `os.availableParallelism()` (capped at 4); locally it stays 4. The CI log now
   uses the list reporter too, so every test's duration is visible on a GREEN
   run and the next test creeping toward 30 s shows up before it fails.
4. **Per-account state is shared across workers.** `users.admin_nav_config` is
   one row per admin. Two specs that wrote the sidebar layout as `testadmin`
   raced: one worker's Reset landed between the other's save and reload. A spec
   that writes per-user state gets its own account (`e2e/lib/accounts.js`
   `seedAdminUser`).
5. **Sign in without the homepage when sign-in is not the test.**
   `signInViaApi()` posts to `/auth/login` (CSRF is off for the test server) and
   shares the page's cookies; the modal stays covered by `auth.spec.js`.

## Per-branch, per-worker databases (landed 2026-09-02, ported from icelandicstore)

Integration suites run in **4 parallel Jest workers**, each against its own
database, and the whole set is **scoped to the checked-out branch** so two
worktrees (or a run plus an orphaned Jest child) never share one.

**Naming** (`tests/workerDb.js`, unit-tested in `tests/unit/workerDb.test.js`):

| Database | Example on branch `feat/harvest-h2` (product `os`) |
|---|---|
| Base (never created, only derived from) | `os_feat_harvest_h2_test` |
| Migrated template | `os_feat_harvest_h2_tmpl_test` |
| Worker N | `os_feat_harvest_h2_w<N>_test` |

The prefix is `engine.json`'s `product` since 2026-09-26 (it was the literal
`orangesmiley` in every repo — see the next section).

The branch name is lower-cased, every non-alphanumeric run becomes `_`, and the
slug is trimmed so the longest derived name fits Postgres's 63-byte identifier
cap (Postgres would otherwise truncate silently). Detached HEAD falls back to
the worktree directory name; no git at all falls back to the unscoped
`<product>_test`. Every derived name keeps the `_test` suffix — the
infixes go BEFORE it — because globalSetup/globalTeardown refuse to drop
anything else.

**Resolution order for the base:**

1. `TEST_DATABASE_URL` — explicit override, used verbatim. CI pins
   `…/orangesmiley_test` (a fresh service container per job, so no scoping
   needed). Use it locally when you want a fixed name, e.g. two runs of the
   same branch at once.
2. Otherwise host/port/credentials come from `TEST_PG_URL` (the throwaway test
   server, next section), else `DATABASE_URL` — each from the process env, then
   `.env`, read without loading it into the env — else
   `postgres:postgres@localhost:5432`, and the database NAME is replaced with
   the per-branch one.

`npm test` prints the resolved base as its first line:

```
[jest] test database base: os_feat_harvest_h2_test on localhost:5433 (from branch, server from TEST_PG_URL) — template …, workers …
```

**Lifecycle.** `tests/globalSetup.js` resolves the base, pins it into
`TEST_DATABASE_URL` for the workers, migrates ONE template in a child process,
then `CREATE DATABASE … TEMPLATE` clones it per worker
(`synchronous_commit = off`); `tests/env.js` derives each worker's
`DATABASE_URL` from `JEST_WORKER_ID`. Within a worker, suites run serially —
exactly the old semantics, so the ordering rules above are unchanged. Serial
fallback: `npm test -- --runInBand` (uses `_w1_test` only).

**Cleanup.** `tests/globalTeardown.js` drops the run's databases at the end of
every run (they are rebuilt from scratch next time anyway); `KEEP_TEST_DB=1
npm test` keeps them so you can inspect a worker DB after a failure. Since
2026-09-26 a killed run no longer leaves its set behind for good: Ctrl-C hands
the drop to a detached cleaner, and the next run's sweep drops what a hard
kill left. The details, and `npm run test:db:clean`, are in the next section.

**Still unsafe:** two concurrent runs of the SAME branch (or pinned to the same
`TEST_DATABASE_URL`) still race in globalSetup's DROP; the advisory lock there
(one per base since 2026-09-26) only serialises the drop/create step. Give one
of them its own `TEST_DATABASE_URL`.

Two rules the port carries: never add an `afterAll` that ends the app pool
(fire-and-forget analytics/event-log writes land after the last test; the 1 s
`DB_POOL_IDLE_MS` in `tests/env.js` handles connection release instead), and
keep the migration in a child process (`CREATE DATABASE … TEMPLATE` refuses
while any session holds the template).

This is engine work, and since D-021 (2026-09-22) this repo IS the engine, so
it is home: ice #225/#233 built it first and it reaches every downstream by
engine-sync merge (`docs/ENGINE-SYNC.md`). The BASE-SYNC queue entry is history.

## The local test cluster and test-database hygiene (2026-09-26)

Why ([test-db-hygiene-2026-09-26](history.d/2026-09-26-feat-test-db-hygiene.md#test-db-hygiene-2026-09-26)):
the shared cluster on `:5432` (the real books DB `orangesmiley_books` + the
dev DBs) had collected **746 leftover test databases**, and a checkpoint there
took ~8 minutes, so every Jest globalSetup in every repo stalled. Four causes,
four fixes: a separate throwaway server, product-scoped names, labels + a
sweep on every run, and a teardown that cannot fail quietly.

### The test server — `TEST_PG_URL`

A second, local PostgreSQL cluster holds nothing but test databases. It runs
with `fsync=off`, `full_page_writes=off`, `synchronous_commit=off`,
`wal_level=minimal`, `max_wal_senders=0`, `checkpoint_timeout=30min`,
`max_wal_size=8GB`, `shared_buffers=512MB`, `max_connections=300`, UTF8
(locale `English_United Kingdom.1252` on Windows) — **throwaway data only: a
crash can corrupt it, by design. Never put a real database on it, and never
point `TEST_PG_URL` at `:5432`.**

```bash
npm run test:pg:init     # initdb into TEST_PG_DATA (default ~/pgtest17/data), port from TEST_PG_URL (default 5433)
npm run test:pg:start    # pg_ctl start, waits until it answers
npm run test:pg:status   # pg_ctl status, the live settings, how many *_test DBs it holds
npm run test:pg:stop
```

`.env` (read by the test tooling without loading it into the env):

```
TEST_PG_URL=postgres://postgres:postgres@localhost:5433
TEST_PG_DATA=C:/Users/<you>/pgtest17/data     # optional: npm test / e2e start the cluster if it is down
TEST_PG_BIN=C:/Program Files/PostgreSQL/17/bin # optional: where pg_ctl/initdb live (that path is the Windows default)
```

| Variable | Effect |
|---|---|
| `TEST_DATABASE_URL` | Explicit pin, used verbatim (CI). Wins over everything. Only the **process** env counts — the Jest main process never loads `.env`, so one written there is ignored (globalSetup now says so). |
| `TEST_PG_URL` | The SERVER for Jest and e2e test databases (process env, then `.env`). The name is still derived. |
| `DATABASE_URL` | The fallback server when `TEST_PG_URL` is unset — the behaviour before 2026-09-26. |
| `E2E_DATABASE_URL` | Playwright's explicit pin (CI). |
| `TEST_PG_DATA` / `TEST_PG_BIN` | Auto-start: when `TEST_PG_URL` refuses connections, globalSetup (and `e2e/global-setup.js`) runs `pg_ctl -D $TEST_PG_DATA -l <data>/../pg_ctl.log start` detached and waits up to 30 s. |

Unset `TEST_PG_URL` = exactly the old behaviour. CI is unchanged: it pins
`TEST_DATABASE_URL`/`E2E_DATABASE_URL` against its own `postgres:16` container.

### Names are per product

The prefix is `engine.json`'s `product` (`os` here; `rk`, `hs`, `ll`, `ice`
downstream), falling back to `package.json`'s name. Until 2026-09-26 it was the
literal `orangesmiley`, and every downstream carries these files unchanged — so
all of them derived the engine's names (`orangesmiley_master_w1_test`,
`orangesmiley_engine_sync_<date>_…`) and one repo's teardown could drop
another repo's live run.

| Database | Example (product `os`, branch `feat/harvest-h2`) |
|---|---|
| Jest base (never created) | `os_feat_harvest_h2_test` |
| Template | `os_feat_harvest_h2_tmpl_test` |
| Worker N | `os_feat_harvest_h2_w<N>_test` |
| A test's extra DB (`createExtraTestDb('demoreset')`) | `os_feat_harvest_h2_w2_demoreset_test` |
| Playwright | `os_e2e_feat_harvest_h2_test` |

The slug is trimmed so the longest name — a worker extra, `_w99_` + 12
characters — fits Postgres's 63 bytes. A test that needs its own database uses
`createExtraTestDb(suffix)` / `extraTestDbUrl(suffix)` from `tests/workerDb.js`
(suffix: 1–12 of `[a-z0-9]`): the run's teardown and the sweep own the name,
so a test that dies before its `afterAll` does not leak it.

### Labels

Every test database gets a label at creation (`COMMENT ON DATABASE`):
`{kind: "jest"|"e2e", product, repo: <git toplevel>, branch, pid, host,
createdAt}`; e2e databases also get `lastUsedAt`, refreshed on every run.
`pid` is the Jest main process's. `KEEP_TEST_DB` adds `keep: true`.

### The sweep — every `npm test`, before provisioning

Inside its advisory lock, globalSetup sweeps THIS product's databases
(`tests/lib/testDbSweep.js`):

| Kind | Dropped when (and it has **no** session) |
|---|---|
| Jest, labelled | its pid is dead (on this host), or it is over 6 h old; a `keep` one only by age |
| e2e, labelled | its branch no longer exists AND its worktree path is gone, or `lastUsedAt` is over 14 days old |
| unlabelled, Jest-shaped | over 24 h old (age of `base/<oid>/PG_VERSION` via `pg_stat_file` — needs superuser; skipped otherwise) |
| unlabelled, e2e-shaped | over 14 days old |

Never touched: a database with a session (the sweep's DROP has no FORCE, so
one that gains a session mid-sweep makes the DROP fail instead), a template
whose sibling workers are busy, a name that is not a derived test name of this
product (strict regexes), a database carrying any other comment, a label for
another product. A sweep error never fails the run. Caveat: a `--watch` session
idle for over 6 h can lose its databases to another run's sweep.

### Teardown and interrupts

- `globalTeardown` drops by pattern (`^<base root>_(w<N>|tmpl)(_<extra>)?_test$`),
  not by counting workers, with `DROP DATABASE … WITH (FORCE)`. A failed drop
  fails the run with the retry command — no more stderr-only leaks.
- `KEEP_TEST_DB=1` keeps them and prints the exact drop command.
- Ctrl-C / SIGTERM / SIGHUP during a run: globalSetup's handler spawns a
  detached `node scripts/drop-test-dbs.js --base <base> --owner-pid <pid>
  --wait --yes` and exits 130/143/129. A hard kill runs nothing; the next run's
  sweep finds the dead pid.
- A migration that fails in globalSetup drops its half-built template before
  the error surfaces.
- The advisory lock is per base (`pg_advisory_lock(<"hall">, hash(base))`), so
  different repos and branches no longer queue behind one global key; two runs
  of the same base still serialise their DROP/CREATE.

### By hand — `npm run test:db:clean`

```bash
npm run test:db:clean                      # today's scope: every idle Jest DB of this product (drops)
npm run test:db:clean -- --e2e             # … and the e2e ones
npm run test:db:clean -- --dry-run         # list only
npm run test:db:clean -- --sweep [--yes]   # the per-run rules (dry run without --yes)
npm run test:db:clean -- --gone  [--yes]   # branch AND worktree gone (labels first, then slugs)
npm run test:db:clean -- --legacy …        # also the old orangesmiley_* names — shared by
                                           # downstreams that have not synced yet: read the plan first
npm run test:db:clean -- --base os_x_test --yes   # one run's set
```

The wider modes are a dry run until `--yes`. To clean another server, point
`TEST_PG_URL` at it for that one command
(`TEST_PG_URL=postgres://postgres:…@localhost:5432 npm run test:db:clean -- --legacy --sweep`)
— and read the plan before adding `--yes`.

### After merging a chunk

```bash
cmd //c rmdir <worktree>\node_modules          # unlink the junction FIRST — rm -rf follows it and empties the source
git worktree remove <worktree>
git branch -d <branch>
npm run test:db:clean -- --gone --yes          # its Jest + e2e databases
```

### TRUNCATE vs DELETE in `cleanTables()` — measured

The brief was: keep TRUNCATE unless the measurement shows a clear win for
DELETE on BOTH durability modes. Each row below is one full `npm test` (213
suites, 4251 tests) on the dev machine (Windows 11, PostgreSQL 17.9). The
`:5434` cluster was a throwaway copy with default durability, the mode `:5432`
runs in; the shared `:5432` itself was never touched. Checkpoint numbers are
`pg_stat_checkpointer` / `pg_stat_wal` deltas.

| Cluster | `cleanTables()` | Wall | Jest `Time` | WAL written | Checkpoint `sync_time` |
|---|---|---|---|---|---|
| `:5433` fsync off | TRUNCATE (old infra) | ≈ 445 s | 310 s | — | — (the teardown checkpoint alone took 121 s) |
| `:5433` fsync off | TRUNCATE (new infra) | 389 s | 382 s | 4.4 GB | 0.08 s |
| `:5433` fsync off | **DELETE** | **49 s** | 43 s | 0.27 GB | 0.03 s |
| `:5434` fsync on | TRUNCATE | 347 s | 342 s | 0.66 GB | 252 s |
| `:5434` fsync on | **DELETE** | **49 s** | 42 s | 0.16 GB | 10 s |

DELETE is about 7× faster in both modes, so `cleanTables()` switched to it.
The cost was not fsync. Every `TRUNCATE … RESTART IDENTITY CASCADE` gives each
table in the users FK closure, with its indexes, toast and sequences, new files.
Each statement took 0.4–0.9 s. The old files wait for the next checkpoint to be
unlinked, and every `DROP DATABASE` forces one immediately. With fsync off, one
such checkpoint took 121 s: write 1.9 s, sync 0.04 s, the rest unlinks. The
second TRUNCATE row ran slower than the first because its sweep integration
test DROPs databases mid-run, and each drop waited on that backlog. The same
row had 16 failures (a TRUNCATE deadlock, the sweep suite timing out, two
registry entries fixed since). With DELETE every row was green.
`wal_level=minimal` made TRUNCATE worse still: a relation created in the same
transaction is WAL-logged whole at commit.

The DELETE form keeps TRUNCATE's semantics. It empties the FK closure that
`CASCADE` would, with `session_replication_role = replica` (FK and ordinary
triggers off, so order and cycles do not matter), and resets every sequence
those tables own to its start, which is what `RESTART IDENTITY` did.
`TEST_CLEAN_MODE=truncate` brings back the old statement. So does a test role
that may not set `session_replication_role`, which means a non-superuser.

## What CI actually runs (`.github/workflows/ci.yml`, re-read 2026-09-24)

Triggers: push and pull request to **`master`** or `main` (the engine and two
products use `master`, hallismiley and icelandicstore `main`), plus a weekly
cron (`17 5 * * 1`) so a new npm advisory or base-image CVE is noticed between
merges. **Push has no paths filter** — the engine's docs are tested content
and master takes direct merges, so every push runs everything. **A pull request
that is documentation only** (`**.md`, `docs/**`, `LICENSE`) skips ci.yml; the
shim `.github/workflows/ci-skipped.yml` then reports the three check names and
runs the unit tier (which holds the docs parity tests) plus the manifest build
under "Lint + Integration tests" ([harvest-ice-f](HISTORY.md#harvest-ice-f-2026-09-24)).
`tests/unit/ciSkippedShim.test.js` fails when the docs list or the check names drift.

Jobs on `ubuntu-latest`, each Jest/e2e/smoke job with its own
`postgres:16-alpine` service container (databases `orangesmiley_test`,
`orangesmiley_e2e`, `orangesmiley_smoke`) and Node **24** (`node-version: 24`
— the same major as the digest-pinned `Dockerfile` base image; the two move
together):

| Job | Steps |
|---|---|
| `lint` — Lint · audit · i18n | `npm ci` · `npm audit --audit-level=high` · `npm run lint` · `npm run check:i18n` · release-manifest schema |
| `test-shard` ×3 — Integration shard N/3 | runner spec · Jest transform cache (per shard) · `npm run test:ci -- --shard=N/3 --coverageThreshold='{}' --coverageReporters=json` · upload `coverage-final.json` |
| `test` — **Lint + Integration tests** (the check name) | `if: always()`; red unless `lint` AND every shard succeeded (cancelled/skipped count as red) · downloads the three coverage maps · `scripts/merge-coverage.js` enforces `jest.config.js`'s global floor on the MERGED map, failing closed on a missing shard |
| `e2e` — E2E tests (Playwright) | Chromium install (cached) · `npm run test:e2e` against two booted servers (ports 3000 and 3001 — the second runs 2FA enrolment `required`), workers = the runner's CPUs (2), list + html reporters |
| `docker` — Docker build + boot smoke test | image build · Trivy (`HIGH,CRITICAL`, `ignore-unfixed`) · boot with `UPLOAD_ROOT` and `DB_SSL=false` declared · readiness probe |

**Why three shards** (icelandicstore #356): the Jest step was most of a
15-minute job, CPU-saturated on the 2-vCPU runner with a broad tail rather than
a few slow suites; runner queue time is seconds, so more machines per run is the
lever. A shard alone can never meet the coverage floor, so shards run with the
threshold off and the aggregator enforces it — change the floor in
`jest.config.js` only (the merge script reads it, and refuses a threshold shape
it cannot enforce). Keep `SHARDS`, the matrix and the `/3` in both names in step.
Locally nothing changed: `npm test` is still one run.

The jobs are otherwise not gated on each other. A shard has a 45-minute ceiling
because a contended 2-vCPU runner showed a 3.7× run-to-run spread on an
identical tree.

## After a deploy — the deployed-environment walkthrough (2026-09-26)

Everything above verifies the **code**. After a deploy (or a self-update, or a
new customer instance) the question is different: does *this box, with this
data and this configuration* behave? Ported from icelandicstore #128
([harvest2-lane0](history.d/2026-09-26-harvest2-lane0-history.md#harvest2-lane0-2026-09-26)),
whose release gate passed 46 routes, zero console errors and four matching
data counts, and still missed a checkout that **quoted 4,421 kr. and booked
4,039 kr.** The stored order was internally consistent; only comparing what
the UI *quoted* with what was *booked* showed it.

**The rule: exercise each write path and read back what was stored — quoted
vs booked.** A read-only sweep tests the reader, not the producer. Note what
the UI shows before you submit, then read the stored record back (admin view
or API) and compare field by field. Label every test record obviously
(`PRÓFUN — <date>`), and remove it the way the product allows (delete a lead,
cancel an order) — never by SQL.

Where writing is acceptable depends on the instance: a canary, the demo or a
fresh customer instance before hand-over take the full list; the live public
site and the ops books take only the reversible writes (a lead, a setting). **A
statutory invoice is never a test on a live ledger** — the invoice series is
gapless and a posted entry is only ever reversed, so that check runs on a
non-production instance.

| Write path | Do | Read back and compare |
|---|---|---|
| Contact form → Fyrirspurnir | send one enquiry from the public contact page | the lead in Admin → Fyrirspurnir (name, email, message, locale); the notification email arrived, from `EMAIL_FROM` with the right Reply-To |
| Signup / sign-in (when the module is on) | create an account, verify, sign in | the verification email's link host is `APP_URL`; the user row's role |
| Invoice (non-production only) | issue one invoice in Bókhald | PDF total = invoice record = the journal lines (balanced) = the VSK report line; the number is the next in the series |
| Accounts + commission | record a service invoice on a test account | the commission event = rate × base, and the statement shows the same amount |
| Seller area | `npm run publish:sellers` on ops | the public instance's `/solusvaedi` shows exactly the ops numbers for that seller |
| Change request / MCP write tool | file one through the widget, and one `file_feature_request` through the connector | both rows in the `/admin/feedback` inbox with the text as sent; the MCP write's security-log line (who and what) |
| Uploads | upload one image | it is served at its URL at full size (proves the `UPLOAD_ROOT` mount) |
| Settings / theme | change one setting and the theme | both survive a reload and a new session |
| Shop (hidden surface, Stripe test mode only) | one order with a plain product and a variant | cart / checkout / button totals vs the stored order's subtotal, VAT and total, and each line's VAT rate |

**Judge each page on three things, not one.** Admin views swallow a failed
data load into an in-page `.admin-error` banner **without a console error**,
so shell-plus-clean-console is a false green. Per route: the URL reached the
intended route, the view's content rendered, and the `.admin-error` count is 0.

**Deployment checks a local suite cannot make:**
- `/ready` answers 200, its `uptime` is younger than the swap, and the
  `X-App-Build` header names the build that was deployed (a restart answers
  from the OLD process first — poll until `uptime` drops).
- The environment is this instance's: `APP_URL`, `EMAIL_FROM`/`EMAIL_REPLY_TO`,
  `INSTANCE_ROLE` (`public` vs `ops`), the release channel. Read them with
  `az` (prefix `MSYS_NO_PATHCONV=1` in Git Bash when an argument is a
  `/unix/path`), not through the UI.
- No served page or request names another instance's host, registry or storage.
- Indexability per host: `robots.txt`, the page's `<meta name="robots">` and
  `sitemap.xml` refuse on any host that is not the real public site.
- Hidden surfaces stay hidden (nav, sitemap, SSR), and a module that is off
  answers 404.

**Harness traps:** a backgrounded browser tab never loads `loading="lazy"`
images (check `document.visibilityState` before believing "images broken");
heavy admin browsing spends the rate-limit budget, so pace the walk.

## Measuring the suite

The counts in the tier table are static declarations, not runtime totals:
`test.each` tables and loop-generated cases expand at runtime, so the executed
number is never lower than the declared one. Re-measure rather than copy a
number forward:

```bash
find tests -name "*.test.js" | wc -l
grep -rhoE "^\s*(test|it)(\.(only|skip|each|concurrent|todo))?\s*[(\`]" tests --include=*.test.js | wc -l
find e2e -name "*.spec.js" | wc -l
grep -rhoE "(^|[^.\w])(test|it)(\.(only|skip|fixme|slow))?\s*\(\s*['\"\`]" e2e --include=*.spec.js | wc -l
```

2026-09-11 @ `8baa090`: 139 files / 2647 declarations (unit 978, integration
1669) and 26 spec files / 178 declarations. Runtime is higher: the unit tier ran
1283 and the smoke tier 112 that day, so expect the full suite well above 2647.
