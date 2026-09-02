# Test tiers — run the right suite for the change

_Introduced 2026-08-24 (Halli's ask: a 1-line prod fix must not cost a full-suite run). The tiers change the **inner loop**; the merge gate is unchanged — every chunk still merges only with the FULL suite green, and CI (`test:ci`) still runs everything._

## The tiers (timings measured 2026-08-24 on the dev machine)

| Command | What | Size / time | DB |
|---|---|---|---|
| `npm run test:unit` | All of `tests/unit/` via `jest.unit.config.js` — no globalSetup (no DB drop/migrate), parallel workers | 981 tests, **~8 s** | none |
| `npm run test:smoke` | Critical-path integration specs: auth, security (CSRF/RBAC/headers/envelope), shop, contact (lead capture) | 112 tests, **~28 s** | yes |
| `npm run test:hotfix` | unit + smoke, in that order | **~36 s** | yes |
| `npm run test:related -- <files…>` | Jest picks every test that (statically) depends on the named source files | varies — see caveat below | maybe |
| `npm test` | Everything (unit + all integration, serial) | ~2012 tests, minutes | yes |
| `npm run test:e2e:smoke` | Playwright: auth, navigation, business-routes | subset of 109 | yes |
| `npm run test:e2e` | Full Playwright suite | 109 tests | yes |

**`test:related` caveat** (measured 2026-08-24): for a *leaf* file (a util, a client script) the related set is small and fast. For a *core* file required by `app.js`'s route tree (services, models, middleware), the related set is most of the integration suite — ~6.7 min for `discountEngine.js` (1201 tests). That is the true blast radius, but locally it defeats the purpose: for core-file fixes run `test:hotfix` and let CI's full run be the wide net.

## The hotfix workflow (production bug)

1. **Reproduce as a failing test first** — in the tier where it belongs (a controller bug → integration spec; pure logic → unit).
2. Fix it.
3. Run `npm run test:hotfix`; add `npm run test:related -- <every file you touched>` when the touched files are leaf modules (see the caveat above — for core files, hotfix + CI is the right pair). Total cost ≈ one minute.
4. Push the branch — CI runs the full suite with coverage exactly as before. CI green is still the deploy gate; the tiers only buy you a fast, high-confidence local loop.
5. If the fix touched auth, payments, RBAC, migrations, or the error envelope: run the full local suite anyway before pushing. Those surfaces are why the smoke tier exists, but they deserve the whole net.

## Rules

- **The smoke list is per-instance.** It names this instance's revenue/security-critical paths. When porting this scheme: icelandicstore's list should be auth, security, shop/orders, adminBookkeeping + the Stripe webhook specs — not `contact`. Keep the list short enough to stay under ~30 s; it is a tripwire, not a safety net.
- **A prod bug that escaped the suite earns a permanent test** in the tier that would have caught it fastest — and if that test is critical-path, it joins the smoke list.
- **Never delete inherited specs** (stack invariant: adapt, don't delete). Tiering reorganizes when tests run, never whether they exist.
- `jest.unit.config.js` derives from `jest.config.js` — config drift between them is a bug. New unit specs must stay DB-free; a unit spec that needs Postgres belongs in `tests/integration/`.

## Hunting an intermittent failure

Suites share one database and Jest orders them by cached duration, so a suite's
*neighbours* change between runs — which is how an order-dependent test fails
"one run in three" with no code change (LESSONS.md 2026-08-27).

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

## Per-worker databases (landed 2026-09-02, ported from icelandicstore)

Integration suites run in **4 parallel Jest workers**, each against its own
database. `tests/globalSetup.js` migrates ONE template (`orangesmiley_tmpl_test`)
in a child process, then `CREATE DATABASE … TEMPLATE` clones it per worker
(`orangesmiley_w1_test` … `_w4_test`, `synchronous_commit = off`);
`tests/env.js` derives each worker's `DATABASE_URL` via `tests/workerDb.js` by
inserting the worker id BEFORE the `_test` suffix, so the `_test$` safety guard
still holds. Within a worker, suites run serially — exactly the old semantics,
so the ordering rules above are unchanged. Serial fallback: `npm test -- --runInBand`
(uses `_w1_test` only).

Two rules the port carries: never add an `afterAll` that ends the app pool
(fire-and-forget analytics/event-log writes land after the last test; the 1 s
`DB_POOL_IDLE_MS` in `tests/env.js` handles connection release instead), and
keep the migration in a child process (`CREATE DATABASE … TEMPLATE` refuses
while any session holds the template).

This is engine work that belongs upstream (ice #225/#233 built it first; the
base `hallismiley` is read-only) — queued in site-factory/BASE-SYNC.md.
