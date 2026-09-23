# Test tiers — run the right suite for the change

_Introduced 2026-08-24 (Halli's ask: a 1-line prod fix must not cost a full-suite run). The tiers change the **inner loop**; the merge gate is unchanged — every chunk still merges only with the FULL suite green, and CI (`test:ci`) still runs everything. Test counts below were re-measured 2026-09-11 — the unit and smoke tiers were RUN that day, the full and e2e suites were counted statically (see "Measuring the suite"); the timings are still the 2026-08-24 dev-machine figures._

## The tiers (timings measured 2026-08-24 on the dev machine)

| Command | What | Size / time | DB |
|---|---|---|---|
| `npm run test:unit` | All of `tests/unit/` via `jest.unit.config.js` — no globalSetup (no DB drop/migrate), parallel workers | 1283 tests at runtime (978 declared in 67 files — `.each` tables expand), **~8 s** | none |
| `npm run test:smoke` | Critical-path integration specs: auth, security (CSRF/RBAC/headers/envelope), shop, contact (lead capture) | 112 tests at runtime (110 declared), **~28 s** | yes |
| `npm run test:hotfix` | unit + smoke, in that order | **~36 s** | yes |
| `npm run test:related -- <files…>` | Jest picks every test that (statically) depends on the named source files | varies — see caveat below | maybe |
| `npm test` | Everything (unit + all integration) in **4 parallel Jest workers, one database each** (`jest.config.js` `maxWorkers: 4`; `npm test -- --runInBand` for serial) | 2647 declared tests in 139 files; not re-timed since the 2026-09-02 parallel split (6 min 37 s serial on 2026-08-24) | yes |
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
- **Engine tests read the product identity, never a brand literal** (`clientConfig.identity` server-side, `public/js/utils/identity.js` client-side, `e2e/lib/identity.js` in Playwright — the seam of 2026-09-22). A downstream that sets its `identity` block in `config/client.json` runs the engine's suites unchanged.

## The feature gate — suites of a hidden feature skip, never get deleted (2026-09-22)

A downstream product hides, disables or forks engine features (LedgerLink has no company site; rekstrarkerfid no seller area). Its graft PRs used to `describe.skip` the engine's suites by hand, which re-conflicts on every sync. Instead the product records the fact once in `features/local.json` — `{ "public-site": { "status": "hidden", "note": "…" } }` — and the gate derives the skip:

- `tests/lib/featureGate.js` is the core: it reads `features/local.json` and the feature registry (`scripts/features-index.js`), maps a suite file to its feature through the registry's `paths` (so the spec → feature mapping is never hand-kept), and answers `gate(featureId)` / `gateForSpec(file)` → `{ skip, status, reason }`. A feature is gated when its local status is `hidden`, `disabled` or `forked`, or when it belongs to ANOTHER product (`features/<other>/`, inert here). An unknown id never skips, so a typo cannot silence a suite.
- Every engine e2e spec starts with `const { gateSpec } = require('./lib/featureGate'); gateSpec(test, __filename);` (`e2e/lib/featureGate.js` wraps `test.skip(condition, note)`). `skipUnless(test, 'seller-publication')` gates one describe.
- Jest suites a product may not run shadow the global: `const describe = describeForSpec(__filename);` — a `describe.skip` whose block name carries the note. Used by the os-owned `salesGuidesServicesPage` / `salesGuidesD001` suites (foreign on any other product) and `sellerArea` (the `seller-publication` feature).
- In the engine `local.json` is empty and every spec runs — `tests/unit/featureGate.test.js` pins that, and exercises a temp `local.json` that hides `public-site`. The skipped tests show in the report with the note, so a downstream's coverage of the engine is visible, not silent.

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

| Database | Example on branch `feat/harvest-h2` |
|---|---|
| Base (never created, only derived from) | `orangesmiley_feat_harvest_h2_test` |
| Migrated template | `orangesmiley_feat_harvest_h2_tmpl_test` |
| Worker N | `orangesmiley_feat_harvest_h2_w<N>_test` |

The branch name is lower-cased, every non-alphanumeric run becomes `_`, and the
slug is trimmed so the longest derived name fits Postgres's 63-byte identifier
cap (Postgres would otherwise truncate silently). Detached HEAD falls back to
the worktree directory name; no git at all falls back to the unscoped
`orangesmiley_test`. Every derived name keeps the `_test` suffix — the
infixes go BEFORE it — because globalSetup/globalTeardown refuse to drop
anything else.

**Resolution order for the base:**

1. `TEST_DATABASE_URL` — explicit override, used verbatim. CI pins
   `…/orangesmiley_test` (a fresh service container per job, so no scoping
   needed). Use it locally when you want a fixed name, e.g. two runs of the
   same branch at once.
2. Otherwise host/port/credentials come from `DATABASE_URL` (process env, then
   `.env`, read without loading it into the env), else
   `postgres:postgres@localhost:5432`, and the database NAME is replaced with
   the per-branch one.

`npm test` prints the resolved base as its first line:

```
[jest] test database base: orangesmiley_feat_harvest_h2_test on localhost:5432 (from branch) — template …, workers …
```

**Lifecycle.** `tests/globalSetup.js` resolves the base, pins it into
`TEST_DATABASE_URL` for the workers, migrates ONE template in a child process,
then `CREATE DATABASE … TEMPLATE` clones it per worker
(`synchronous_commit = off`); `tests/env.js` derives each worker's
`DATABASE_URL` from `JEST_WORKER_ID`. Within a worker, suites run serially —
exactly the old semantics, so the ordering rules above are unchanged. Serial
fallback: `npm test -- --runInBand` (uses `_w1_test` only).

**Cleanup.** `tests/globalTeardown.js` drops the template and worker databases
at the end of every run (they are rebuilt from scratch next time anyway).
`KEEP_TEST_DB=1 npm test` keeps them so you can inspect a worker DB after a
failure. A run that is killed before teardown — stopping a shell does NOT stop
its Jest child — leaves its set behind, one per branch:

```bash
npm run test:db:clean              # drop every *_w<N>_test / *_tmpl_test (+ legacy orangesmiley_test)
npm run test:db:clean -- --dry-run # list only
npm run test:db:clean -- --e2e     # also the Playwright orangesmiley_e2e_*_test databases
```

Databases with an active session are skipped, never terminated — the script
cleans orphans, it does not stop someone else's run.

**Still unsafe:** two concurrent runs of the SAME branch (or pinned to the same
`TEST_DATABASE_URL`) still race in globalSetup's DROP; the advisory lock there
only serialises the drop/create step. Give one of them its own
`TEST_DATABASE_URL`.

Two rules the port carries: never add an `afterAll` that ends the app pool
(fire-and-forget analytics/event-log writes land after the last test; the 1 s
`DB_POOL_IDLE_MS` in `tests/env.js` handles connection release instead), and
keep the migration in a child process (`CREATE DATABASE … TEMPLATE` refuses
while any session holds the template).

This is engine work, and since D-021 (2026-09-22) this repo IS the engine, so
it is home: ice #225/#233 built it first and it reaches every downstream by
engine-sync merge (`docs/ENGINE-SYNC.md`). The BASE-SYNC queue entry is history.

## What CI actually runs (`.github/workflows/ci.yml`, read 2026-09-11)

Triggers: push and pull request to **`master`** (the long-lived branch — the
file said `main` until 2026-09-02 and CI had never run), plus a weekly cron
(`17 5 * * 1`) so a new npm advisory or base-image CVE is noticed between
merges. There is **no `paths` / `paths-ignore` filter**: a markdown-only
commit or pull request runs the whole workflow.

Three independent jobs on `ubuntu-latest`, each with its own
`postgres:16-alpine` service container (databases `orangesmiley_test`,
`orangesmiley_e2e`, `orangesmiley_smoke`) and Node **24** (`node-version: 24`
— the same major as the digest-pinned `Dockerfile` base image; the two move
together):

| Job | Steps |
|---|---|
| `test` — Lint + Integration tests | `npm ci` · `npm audit --audit-level=high` · `npm run lint` · `npm run check:i18n` · runner spec · release-manifest schema · Jest transform cache · `npm run test:ci` (coverage) |
| `e2e` — E2E tests (Playwright) | Chromium install (cached) · `npm run test:e2e` against a booted server, workers = the runner's CPUs (2), list + html reporters |
| `docker` — Docker build + boot smoke test | image build · Trivy (`HIGH,CRITICAL`, `ignore-unfixed`) · boot with `UPLOAD_ROOT` and `DB_SSL=false` declared · readiness probe |

The jobs are deliberately not gated on each other. The `test` job has a
45-minute ceiling because a contended 2-vCPU runner showed a 3.7× run-to-run
spread on an identical tree.

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
