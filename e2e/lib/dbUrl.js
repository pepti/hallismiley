// Single source of truth for which Postgres database the e2e suite runs
// against. We deliberately target an isolated, throwaway `_test` database —
// NOT the dev DB, and NEVER Jest's.
//
// History, both halves inherited from icelandicstore's fix (#197):
//
// ⚠️ Until the 2026-08-22 harvest this suite ran against whatever `.env`
// DATABASE_URL said — the DEV database. Every local run upserted the e2e
// admin, reseeded fixture projects and left walkthrough writes in the data
// you develop against.
//
// ⚠️ The e2e database must also NEVER be the one Jest uses
// (orangesmiley_test): `tests/globalSetup.js` opens every Jest run with
// pg_terminate_backend + DROP DATABASE on its target. If both suites resolve
// to the same name, any `npx jest` in a second terminal kills a running
// Playwright suite mid-flight — every spec goes red at once with
// "terminating connection due to administrator command", which reads like a
// broken app rather than a name collision. That is why TEST_DATABASE_URL is
// not honoured verbatim here: it is Jest's variable, and pointing e2e at it
// aims the suite straight at the database Jest drops.
//
// The name is per-branch because parallel worktrees each run their own suite
// and the suite WRITES; two runs sharing a database interleave and fail in
// ways that look like product bugs.
//
// Resolution order:
//   1. E2E_DATABASE_URL — explicit override, used verbatim (CI pins this)
//   2. otherwise take host/port/credentials from TEST_PG_URL (the local
//      throwaway test cluster, docs/TESTING.md), else TEST_DATABASE_URL, else
//      DATABASE_URL (.env), else the localhost default — and replace the
//      database NAME with the derived per-branch e2e name. Borrowing the
//      connection details keeps this working whatever the local password is.
//
// The name is `<product>_e2e_<branch>_test` (tests/workerDb.js e2eTestDbName;
// the product id comes from engine.json since 2026-09-26 — before that every
// repo derived the same `orangesmiley_e2e_…` names on one shared server).
//
// These databases persist one per branch, by design (a re-run reuses one).
// e2e/global-setup.js labels each with its branch, worktree and lastUsedAt,
// and every Jest run's sweep drops those whose branch AND worktree are gone
// or that sat unused for 14 days (tests/lib/testDbSweep.js). By hand:
//   npm run test:db:clean -- --gone          # plan
//   npm run test:db:clean -- --gone --yes    # drop
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const { branchSlug, e2eTestDbName } = require('../../tests/workerDb');

// Connection details only — the database name here is a placeholder that
// e2eDatabaseUrl always overwrites. Deliberately NOT a Jest name: a constant
// naming Jest's database in this file would read like an endorsement, and any
// future early return of it would restore the very collision above.
const DEFAULT_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';

// The checked-out branch as a slug; '' when git is unavailable or HEAD is
// detached, which just yields the unsuffixed name — a shared database is
// still better than a crashed config.
function e2eDatabaseName() {
  return e2eTestDbName(branchSlug());
}

function e2eDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const base = process.env.TEST_PG_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_URL;
  const u = new URL(base);
  u.pathname = `/${e2eDatabaseName()}`;
  return u.toString();
}

module.exports = { e2eDatabaseUrl, e2eDatabaseName };
