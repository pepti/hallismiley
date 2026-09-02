// Test-database naming, shared by tests/env.js (runs in each Jest worker),
// tests/globalSetup.js / globalTeardown.js (run once in the main process) and
// scripts/drop-test-dbs.js. Per-worker naming ported from icelandicstore
// (ice #225); per-BRANCH scoping added 2026-09-02 (see below).
//
// Jest runs suites in parallel workers since the per-worker-DB rework, and the
// suites are provably unsafe against ONE shared database (fixed fixture ids,
// cleanTables()'s TRUNCATE … CASCADE, the app_settings singleton,
// migrateRunner touching schema_migrations). So every worker gets its own
// database, derived from the BASE test URL by inserting the worker id BEFORE
// the `_test` suffix — `orangesmiley_test` → `orangesmiley_w2_test` — so the
// generated name still satisfies globalSetup's `_test$` safety guard. Within a
// worker, suites run serially: exactly the old semantics.
//
// ⚠️ Why the base is scoped per branch (2026-09-02): TEST_DATABASE_URL is not
// in anyone's .env, so every `npm test` used to fall through to the same
// `orangesmiley_test` base and the same `orangesmiley_w1..4_test` workers.
// Two runs from different worktrees — or one run plus an orphaned Jest child
// (stopping a shell does not stop its Jest) — then trampled each other:
// globalSetup's DROP DATABASE wiped the other run's fixtures mid-suite and
// 106 tests in 13 suites went red (401/500 in admin.test.js and friends) with
// nothing wrong in the code. e2e/lib/dbUrl.js had already solved the same
// collision for Playwright with a per-branch name; this is the same idea.
//
// Resolution order for the BASE url:
//   1. TEST_DATABASE_URL — explicit override, used verbatim (CI pins this;
//      the name must still end in `_test`).
//   2. otherwise: host/port/credentials from DATABASE_URL (process env, then
//      the repo's .env), else the localhost default — with the database NAME
//      replaced by `orangesmiley_<scope>_test`, where <scope> is the checked-
//      out branch as an identifier-safe slug (falls back to the worktree
//      directory name on a detached HEAD, and to the unscoped name when
//      neither is known). globalSetup pins the resolved value back into
//      TEST_DATABASE_URL so every worker derives from the same string.
//
// Layout of a fully derived name (Postgres caps identifiers at 63 bytes and
// truncates SILENTLY past that, so the slug is trimmed here):
//   orangesmiley _ <branch slug> _tmpl _test   ← migrated template (globalSetup)
//   orangesmiley _ <branch slug> _w<N> _test   ← one per Jest worker
//
// No clash with the Playwright tier: e2e/lib/dbUrl.js derives
// `orangesmiley_e2e_<branch>_test`, a different infix.
//
// These databases are dropped again by tests/globalTeardown.js (opt out with
// KEEP_TEST_DB=1 to inspect one after a failure). A run that is killed before
// teardown leaves its set behind — `npm run test:db:clean` drops the lot.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_TEST_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/orangesmiley_test';
const TEST_SUFFIX = '_test';
const MAX_IDENTIFIER = 63;
// Longest infix inserted before `_test` by workerDbUrl()/templateDbName():
// `_tmpl` (5 chars); `_w<N>` stays within that for any sane worker count.
const INFIX_RESERVE = 5;

const ENV_FILE = path.join(__dirname, '..', '.env');

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function dbNameOf(url) {
  return new URL(url).pathname.replace(/^\//, '');
}

function assertTestName(name) {
  if (!name || !name.endsWith(TEST_SUFFIX)) {
    throw new Error(
      `Refusing test DB derivation from "${name}" — base name must end in ${TEST_SUFFIX}.`
    );
  }
  return name;
}

function defaultGitExec() {
  return execSync('git rev-parse --abbrev-ref HEAD', {
    cwd: __dirname,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  });
}

/**
 * The checked-out branch as an identifier-safe slug. '' when git is
 * unavailable or HEAD is detached — the caller then falls back further.
 * `exec` is injectable for the unit test.
 */
function branchSlug(exec = defaultGitExec) {
  let branch;
  try {
    branch = String(exec()).trim();
  } catch {
    return '';
  }
  if (!branch || branch === 'HEAD') return ''; // detached
  return slugify(branch);
}

/** The worktree directory name as a slug — the detached-HEAD fallback. */
function worktreeSlug(dir = path.resolve(__dirname, '..')) {
  return slugify(path.basename(dir));
}

/** { scope, source } — where the default base name gets its suffix from. */
function testScope() {
  const branch = branchSlug();
  if (branch) return { scope: branch, source: 'branch' };
  const dir = worktreeSlug();
  if (dir) return { scope: dir, source: 'worktree' };
  return { scope: '', source: 'unscoped' };
}

/**
 * `orangesmiley_test` + scope → `orangesmiley_<scope>_test`, trimmed so the
 * longest derived name (template / worker) still fits in 63 bytes. An empty
 * scope returns the base name unchanged.
 */
function scopedTestDbName(baseName, scope) {
  assertTestName(baseName);
  const prefix = baseName.slice(0, -TEST_SUFFIX.length);
  const slug = slugify(scope);
  if (!slug) return baseName;
  const room = MAX_IDENTIFIER - prefix.length - 1 - INFIX_RESERVE - TEST_SUFFIX.length;
  const trimmed = slug.slice(0, Math.max(0, room)).replace(/_+$/, '');
  return trimmed ? `${prefix}_${trimmed}${TEST_SUFFIX}` : baseName;
}

// DATABASE_URL from the repo's .env, read WITHOUT loading the file into
// process.env: the Jest main process's env is inherited by every worker, and
// tests/env.js deliberately controls what the app sees.
function envFileDatabaseUrl(file = ENV_FILE) {
  try {
    const parsed = require('dotenv').parse(fs.readFileSync(file, 'utf8'));
    return parsed.DATABASE_URL || '';
  } catch {
    return '';
  }
}

/**
 * Resolve the BASE test URL: { url, name, source }.
 * `source` is 'TEST_DATABASE_URL' | 'branch' | 'worktree' | 'unscoped'.
 * `env` and `scope` are injectable for the unit test.
 */
function resolveTestBaseUrl(env = process.env, scope = undefined) {
  if (env.TEST_DATABASE_URL) {
    const name = assertTestName(dbNameOf(env.TEST_DATABASE_URL));
    return { url: env.TEST_DATABASE_URL, name, source: 'TEST_DATABASE_URL' };
  }
  const { scope: derived, source } = scope === undefined ? testScope() : { scope, source: 'branch' };
  const conn = env.DATABASE_URL || envFileDatabaseUrl() || DEFAULT_TEST_DATABASE_URL;
  const url = new URL(conn);
  const name = scopedTestDbName(dbNameOf(DEFAULT_TEST_DATABASE_URL), derived);
  url.pathname = `/${name}`;
  return { url: url.toString(), name, source: derived ? source : 'unscoped' };
}

function baseTestUrl() {
  return resolveTestBaseUrl().url;
}

/**
 * Returns { url, name } for the given 1-based worker id.
 * Throws if the base DB name does not end in `_test` (same safety contract
 * as globalSetup — never point workers at a non-test database).
 */
function workerDbUrl(workerId, base = baseTestUrl()) {
  const url = new URL(base);
  const name = assertTestName(dbNameOf(base));
  const workerName = name.replace(/_test$/, `_w${workerId}_test`);
  url.pathname = `/${workerName}`;
  return { url: url.toString(), name: workerName };
}

/** The migrated template globalSetup clones per worker: `<base>_tmpl_test`. */
function templateDbName(baseName) {
  return assertTestName(baseName).replace(/_test$/, '_tmpl_test');
}

/** Admin connection (database `postgres`) on the same server as `base`. */
function adminDbUrl(base = baseTestUrl()) {
  const url = new URL(base);
  url.pathname = '/postgres';
  return url.toString();
}

/**
 * True for a name this module could have derived: `<anything>_w<N>_test` or
 * `<anything>_tmpl_test`. scripts/drop-test-dbs.js uses it to find orphans.
 */
function isDerivedTestDbName(name) {
  return /_(w\d+|tmpl)_test$/.test(name);
}

module.exports = {
  DEFAULT_TEST_DATABASE_URL,
  slugify,
  branchSlug,
  worktreeSlug,
  testScope,
  scopedTestDbName,
  resolveTestBaseUrl,
  baseTestUrl,
  workerDbUrl,
  templateDbName,
  adminDbUrl,
  isDerivedTestDbName,
};
