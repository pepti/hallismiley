<a id="test-db-hygiene-2026-09-26"></a>
## 2026-09-26 — Test-database hygiene: a throwaway test server, product-scoped names, labels and a sweep, DELETE instead of TRUNCATE

Halli approved this on 2026-09-26. Branch `feat/test-db-hygiene`. Engine only; every downstream gets
it by the next engine-sync.

**Why.** The shared local cluster on `:5432` holds the real books (`orangesmiley_books`) and the dev
databases. It had collected **746 leftover test databases**, and a checkpoint there took about
8 minutes, so every Jest globalSetup in every repo stalled. The read-only reviews that morning found
five causes:
- `globalTeardown` dropped only the names its own run counted (`w1..N`). It never ran after Ctrl-C,
  a hard kill or a failed globalSetup (a failed migration left its template behind). A failed drop
  only printed to stderr.
- `drop-test-dbs.js` was manual and only knew the `orangesmiley_` prefix. The e2e databases were kept
  per branch forever, by design.
- **The prefix was the literal `orangesmiley`** in `tests/workerDb.js` and `e2e/lib/dbUrl.js`, and
  every downstream carries those files unchanged. rekstrarkerfid, hallismiley and LedgerLink
  therefore derived the engine's own names (`orangesmiley_master_w1_test`), so one repo's teardown
  could drop another repo's live run.
- One advisory-lock key for everybody, so every session's setup waited in one queue.
- `featureRegistry.test.js` leaked a `features-foreign-*` temp directory per run (99 of them sat in
  `%TEMP%` that day).

**What changed.**
- **A throwaway test server** (`TEST_PG_URL`, `tests/lib/testPg.js`, `scripts/test-pg.js`,
  `npm run test:pg:init|start|status|stop`). It is a PostgreSQL 17 cluster on `:5433` with fsync,
  full_page_writes and synchronous_commit off, and it holds only test databases. When
  `TEST_PG_URL` is set (in the process env or `.env`), Jest and e2e create their databases there. If
  it is unset, the old DATABASE_URL-host behaviour applies. `TEST_DATABASE_URL` and
  `E2E_DATABASE_URL` still win as explicit pins, so CI is unchanged. With `TEST_PG_DATA` set, a
  refused connection makes globalSetup (and the e2e provision step) start the cluster with a
  detached `pg_ctl` and wait up to 30 s.
- **Names are per product.** The prefix is `engine.json` `product` (`os`), falling back to
  `package.json`'s name: `os_<branch>_tmpl_test`, `os_<branch>_w<N>_test`, `os_e2e_<branch>_test`. The
  identifier reserve grew to 17 characters so that a test's own extra database fits too
  (`extraTestDbUrl` / `createExtraTestDb`, `…_w2_<suffix>_test`). The teardown and the sweep own
  those names.
- **Every test database is labelled** at creation with `COMMENT ON DATABASE` (built with
  `format('%I', '%L')`): kind, product, repo, branch, pid, host, createdAt. e2e databases also get
  `lastUsedAt` on every run.
- **A sweep runs at the start of every `npm test`** (`tests/lib/testDbSweep.js`), inside the lock and
  before provisioning. It drops this product's Jest databases whose owner pid is dead or that are
  over 6 h old. It drops e2e databases whose branch and worktree are both gone, or that sat unused
  for 14 days, and unlabelled derived names over 24 h (the age comes from `pg_stat_file`). It never
  touches a database that has a session, anything that is not a derived name of this product, or a
  database that carries another comment. The sweep's DROP has no FORCE.
  `npm run test:db:clean` exposes the same machinery: `--sweep`, `--gone`, `--legacy`, `--base`.
  Those modes print a dry run unless `--yes` is given; the default and `--e2e` behave as before.
- **Teardown** drops by pattern with `WITH (FORCE)` and fails the run, with the retry command, when
  a drop fails. `KEEP_TEST_DB` prints the exact drop command and marks the set `keep`.
  Ctrl-C/SIGTERM/SIGHUP spawn a detached `drop-test-dbs.js --base … --owner-pid … --wait --yes`, and
  a failed migration drops its half-built template.
- **The advisory lock is per base** (`pg_advisory_lock("hall", hash(base))`).
- **`cleanTables()` uses DELETE instead of TRUNCATE** (measured below). It empties the same FK
  closure that `TRUNCATE … CASCADE` did, with FK triggers off, then resets the owned sequences.
- `featureRegistry.test.js` removes its temp directory.

**Measured** (full `npm test`, 213 suites / 4251 tests, the same machine, one run each):

| Cluster | cleanTables | Wall | WAL | checkpoint sync |
|---|---|---|---|---|
| :5433 fsync off | TRUNCATE (before this chunk) | ≈ 445 s (310 s Jest + a 121 s teardown checkpoint) | — | — |
| :5433 fsync off | TRUNCATE | 389 s | 4.4 GB | 0.08 s |
| :5433 fsync off | DELETE | 49 s | 0.27 GB | 0.03 s |
| :5434 fsync on (throwaway copy, default durability) | TRUNCATE | 347 s | 0.66 GB | 252 s |
| :5434 fsync on | DELETE | 49 s | 0.16 GB | 10 s |

The TRUNCATE churn was the cost. The time did not go into fsync: every `TRUNCATE … RESTART IDENTITY
CASCADE` gives ~100 relations new files, the old files wait for the next checkpoint to be unlinked,
and every DROP DATABASE forces an immediate checkpoint. One such checkpoint took 121 s with fsync off
(write 1.9 s, sync 0.04 s, the rest unlinks), and each TRUNCATE statement took 0.4–0.9 s on
Windows. So the switch was made on the measurement, on both modes, as the brief required.

**Not done / owed.**
- The downstreams keep deriving `orangesmiley_*` names until their next engine-sync. After that,
  `npm run test:db:clean -- --legacy --sweep` (dry run first) on `:5432` clears the old names. It
  was not run here: this chunk never touched `:5432`.
- The in-flight branch whose test creates `demo_reset_${pid}_test` should switch to
  `createExtraTestDb('demoreset')`.
- A real Ctrl-C in a terminal was not exercised. The handler was driven with `process.emit('SIGINT')`,
  and the detached cleaner dropped the set once the session had gone.
