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
// (hallismiley_test): `tests/globalSetup.js` opens every Jest run with
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
//   2. otherwise take host/port/credentials from TEST_DATABASE_URL, else
//      DATABASE_URL (.env), else the localhost default — and replace the
//      database NAME with the derived per-branch e2e name. Borrowing the
//      connection details keeps this working whatever the local password is.
//
// These databases accumulate one per branch. They are throwaway: drop the lot
// with
//   psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'hallismiley_e2e%'" \
//     | xargs -r -n1 dropdb
const { execSync } = require('child_process');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });

// Connection details only — the database name here is a placeholder that
// e2eDatabaseUrl always overwrites. Deliberately NOT hallismiley_test: a
// constant naming Jest's database in this file would read like an endorsement,
// and any future early return of it would restore the very collision above.
const DEFAULT_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
const PREFIX = 'hallismiley_e2e';
const MAX_IDENTIFIER = 63; // Postgres truncates silently past this — do it ourselves

// The checked-out branch, reduced to an identifier-safe slug. Returns '' when
// git is unavailable or HEAD is detached, which just yields the unsuffixed
// name — a shared database is still better than a crashed config.
function branchSlug() {
  let branch;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).trim();
  } catch {
    return '';
  }
  if (!branch || branch === 'HEAD') return ''; // detached
  return branch.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function e2eDatabaseName() {
  const slug = branchSlug();
  const room = MAX_IDENTIFIER - PREFIX.length - '_test'.length - 1; // 1 for the joining _
  const trimmed = slug.slice(0, Math.max(0, room)).replace(/_+$/, '');
  return `${PREFIX}${trimmed ? `_${trimmed}` : ''}_test`;
}

function e2eDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const base = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_URL;
  const u = new URL(base);
  u.pathname = `/${e2eDatabaseName()}`;
  return u.toString();
}

module.exports = { e2eDatabaseUrl, e2eDatabaseName };
