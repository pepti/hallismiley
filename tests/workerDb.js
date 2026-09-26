// Test-database naming, shared by tests/env.js (runs in each Jest worker),
// tests/globalSetup.js / globalTeardown.js (run once in the main process),
// tests/lib/testDbSweep.js, e2e/lib/dbUrl.js and scripts/drop-test-dbs.js.
// Per-worker naming ported from icelandicstore (ice #225); per-BRANCH scoping
// added 2026-09-02; per-PRODUCT prefix + the TEST_PG_URL server seam added
// 2026-09-26 (test-db-hygiene-2026-09-26, docs/TESTING.md).
//
// Jest runs suites in parallel workers since the per-worker-DB rework, and the
// suites are provably unsafe against ONE shared database (fixed fixture ids,
// cleanTables() emptying the whole users FK closure, the app_settings singleton,
// migrateRunner touching schema_migrations). So every worker gets its own
// database, derived from the BASE test URL by inserting the worker id BEFORE
// the `_test` suffix — `os_master_test` → `os_master_w2_test` — so the
// generated name still satisfies globalSetup's `_test$` safety guard. Within a
// worker, suites run serially: exactly the old semantics.
//
// ⚠️ Why the base is scoped per branch (2026-09-02): with one fixed base every
// `npm test` in every worktree shared the same worker databases, and two runs
// (or one run plus an orphaned Jest child) trampled each other — globalSetup's
// DROP DATABASE wiped the other run's fixtures mid-suite (106 red tests, no
// code fault).
//
// ⚠️ Why the prefix is the PRODUCT id (2026-09-26): the prefix used to be the
// literal `orangesmiley`, and every downstream (rekstrarkerfid, hallismiley,
// LedgerLink) carries this file byte-identical — so they all computed the SAME
// names as the engine (`orangesmiley_master_w1_test` …) on one shared server,
// and one repo's teardown could drop another repo's live run. The prefix is
// now engine.json's `product` (`os` here, `rk`, `hs`, `ll`, `ice` downstream),
// falling back to package.json's name.
//
// Resolution order for the BASE url:
//   1. TEST_DATABASE_URL — explicit override, used verbatim (CI pins this;
//      the name must still end in `_test`).
//   2. otherwise: the SERVER comes from TEST_PG_URL (process env, then the
//      repo's .env) — the local throwaway test cluster, docs/TESTING.md — else
//      DATABASE_URL (process env, then .env), else the localhost default; and
//      the database NAME is `<product>_<scope>_test`, where <scope> is the
//      checked-out branch as an identifier-safe slug (falls back to the
//      worktree directory name on a detached HEAD, and to the unscoped name
//      when neither is known). globalSetup pins the resolved value back into
//      TEST_DATABASE_URL so every worker derives from the same string.
//
// Layout of a fully derived name (Postgres caps identifiers at 63 bytes and
// truncates SILENTLY past that, so the slug is trimmed here):
//   <product> _ <branch slug> _tmpl _test          ← migrated template (globalSetup)
//   <product> _ <branch slug> _w<N> _test          ← one per Jest worker
//   <product> _ <branch slug> _w<N> _<extra> _test ← a test's own extra DB (extraTestDbUrl)
//
// No clash with the Playwright tier: e2e/lib/dbUrl.js derives
// `<product>_e2e_<branch>_test` (e2eTestDbName below), a different infix.
//
// These databases are dropped again by tests/globalTeardown.js (opt out with
// KEEP_TEST_DB=1), by the next run's sweep when a run dies first
// (tests/lib/testDbSweep.js), and by `npm run test:db:clean`.

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEST_SUFFIX = '_test';
const MAX_IDENTIFIER = 63;
// A test's extra database suffix: lower-case alphanumerics, no underscore (so
// the name stays unambiguous), at most this long.
const EXTRA_SUFFIX_MAX = 12;
const EXTRA_SUFFIX_RE = new RegExp(`^[a-z0-9]{1,${EXTRA_SUFFIX_MAX}}$`);
// Longest infix inserted before `_test`: `_tmpl` (5) or `_w<NN>_<extra>`
// (4 + 1 + 12 = 17) — two-digit worker ids are plenty (maxWorkers is 4).
const INFIX_RESERVE = Math.max('_tmpl'.length, '_w99_'.length + EXTRA_SUFFIX_MAX);
// Namespace half of the two-key advisory lock (0x68616c6c, "hall"); the other
// half is a hash of the base name, so each base has its own lock.
const LOCK_NAMESPACE = 1751215212;

const ENV_FILE = path.join(ROOT, '.env');

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The product prefix every test database name starts with: engine.json's
 * `product`, else package.json's `name`, slugged. `root` is injectable.
 */
function productPrefix(root = ROOT) {
  const fromEngine = slugify((readJson(path.join(root, 'engine.json')) || {}).product);
  if (fromEngine) return fromEngine;
  const fromPackage = slugify((readJson(path.join(root, 'package.json')) || {}).name);
  return fromPackage || 'app';
}

const PRODUCT = productPrefix();
// The pre-2026-09-26 prefix every repo shared; only the sweep's --legacy looks at it.
const LEGACY_PREFIX = 'orangesmiley';

const DEFAULT_TEST_DATABASE_URL =
  `postgresql://postgres:postgres@localhost:5432/${PRODUCT}_test`;

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
 * `<product>_test` + scope → `<product>_<scope>_test`, trimmed so the longest
 * derived name (template / worker / worker extra) still fits in 63 bytes. An
 * empty scope returns the base name unchanged.
 *
 * A slug that ENDS like a run infix (`…_w2`, `…_tmpl`, or is one) gets `_b`
 * appended: otherwise branch `feat/x-w2`'s workers (`os_feat_x_w2_w1_test`)
 * would match branch `feat/x`'s run pattern and its teardown, which drops
 * WITH (FORCE). `reserve` is injectable only to re-derive pre-2026-09-26
 * names (the old reserve was 5) for the sweep's --legacy mode.
 */
function scopedTestDbName(baseName, scope, reserve = INFIX_RESERVE) {
  assertTestName(baseName);
  const prefix = baseName.slice(0, -TEST_SUFFIX.length);
  const slug = slugify(scope);
  if (!slug) return baseName;
  const room = Math.max(0, MAX_IDENTIFIER - prefix.length - 1 - reserve - TEST_SUFFIX.length);
  let trimmed = slug.slice(0, room).replace(/_+$/, '');
  if (reserve === INFIX_RESERVE && RUN_INFIX_TAIL_RE.test(trimmed)) {
    trimmed = `${trimmed.slice(0, Math.max(0, room - 2)).replace(/_+$/, '')}_b`.replace(/^_/, '');
  }
  return trimmed ? `${prefix}_${trimmed}${TEST_SUFFIX}` : baseName;
}
// A slug tail that would read as a run infix: `w<N>` or `tmpl`, alone or after `_`.
const RUN_INFIX_TAIL_RE = /(^|_)(w\d+|tmpl)$/;

/** The Playwright database: `<product>_e2e[_<scope>]_test`, trimmed to 63 bytes. */
function e2eTestDbName(scope, product = PRODUCT) {
  const prefix = `${product}_e2e`;
  const room = MAX_IDENTIFIER - prefix.length - TEST_SUFFIX.length - 1;
  const trimmed = slugify(scope).slice(0, Math.max(0, room)).replace(/_+$/, '');
  return `${prefix}${trimmed ? `_${trimmed}` : ''}${TEST_SUFFIX}`;
}

// Values from the repo's .env, read WITHOUT loading the file into
// process.env: the Jest main process's env is inherited by every worker, and
// tests/env.js deliberately controls what the app sees.
function envFileValues(file = ENV_FILE) {
  try {
    return require('dotenv').parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function fileEnvValue(key, file = ENV_FILE) {
  return envFileValues(file)[key] || '';
}

/**
 * Resolve the BASE test URL: { url, name, source, server }.
 * `source` is 'TEST_DATABASE_URL' | 'branch' | 'worktree' | 'unscoped';
 * `server` is where the host/port came from: 'TEST_DATABASE_URL' |
 * 'TEST_PG_URL' | 'DATABASE_URL' | 'default'.
 * `env`, `scope` and `fileEnv` (the parsed .env) are injectable for the unit test.
 */
function resolveTestBaseUrl(env = process.env, scope = undefined, fileEnv = undefined) {
  if (env.TEST_DATABASE_URL) {
    const name = assertTestName(dbNameOf(env.TEST_DATABASE_URL));
    return { url: env.TEST_DATABASE_URL, name, source: 'TEST_DATABASE_URL', server: 'TEST_DATABASE_URL' };
  }
  const file = fileEnv === undefined ? envFileValues() : fileEnv;
  const { scope: derived, source } = scope === undefined ? testScope() : { scope, source: 'branch' };
  let conn;
  let server;
  if (env.TEST_PG_URL || file.TEST_PG_URL) {
    conn = env.TEST_PG_URL || file.TEST_PG_URL;
    server = 'TEST_PG_URL';
  } else if (env.DATABASE_URL || file.DATABASE_URL) {
    conn = env.DATABASE_URL || file.DATABASE_URL;
    server = 'DATABASE_URL';
  } else {
    conn = DEFAULT_TEST_DATABASE_URL;
    server = 'default';
  }
  const url = new URL(conn);
  const name = scopedTestDbName(`${PRODUCT}${TEST_SUFFIX}`, derived);
  url.pathname = `/${name}`;
  return { url: url.toString(), name, source: derived ? source : 'unscoped', server };
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

/**
 * A test's OWN extra database, derived from its worker database:
 * `…_w2_test` + `demo` → `…_w2_demo_test`. The run's teardown and the sweep
 * own the name (isDerivedTestDbName), so a test that dies before its own
 * cleanup does not leak it. `suffix`: 1–12 of [a-z0-9].
 */
function extraTestDbUrl(suffix, workerUrl = process.env.DATABASE_URL) {
  if (!EXTRA_SUFFIX_RE.test(String(suffix))) {
    throw new Error(`Extra test DB suffix "${suffix}" must be 1–${EXTRA_SUFFIX_MAX} of [a-z0-9].`);
  }
  const url = new URL(workerUrl);
  const name = dbNameOf(workerUrl);
  if (!/_w\d+_test$/.test(name)) {
    throw new Error(`Extra test DBs derive from a worker DB (…_w<N>_test), not "${name}".`);
  }
  const extra = name.replace(/_test$/, `_${suffix}_test`);
  if (extra.length > MAX_IDENTIFIER) {
    throw new Error(`Extra test DB name "${extra}" exceeds ${MAX_IDENTIFIER} bytes.`);
  }
  url.pathname = `/${extra}`;
  return { url: url.toString(), name: extra };
}

/**
 * Create (from the server default, template1, unless `template` is given) and label a test's extra
 * database; returns { url, name, drop() }. Call drop() in afterAll — the
 * run's teardown drops it too if the test never gets there.
 */
async function createExtraTestDb(suffix, { template } = {}) {
  const { Client } = require('pg');
  const sweep = require('./lib/testDbSweep');
  const { url, name } = extraTestDbUrl(suffix);
  if (template !== undefined && !/^[a-z0-9_]{1,63}$/.test(String(template))) {
    throw new Error(`Template "${template}" must be a plain identifier ([a-z0-9_]).`);
  }
  const admin = new Client({ connectionString: adminDbUrl(url) });
  await admin.connect();
  try {
    await sweep.forceDropDatabase(admin, name);
    await admin.query(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ''}`);
    await sweep.labelDatabase(admin, name, sweep.buildLabel('jest', { extra: suffix }));
  } finally {
    await admin.end();
  }
  return {
    url,
    name,
    async drop() {
      const c = new Client({ connectionString: adminDbUrl(url) });
      await c.connect();
      try { await sweep.forceDropDatabase(c, name); } finally { await c.end(); }
    },
  };
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
 * True for a name this module could have derived: `<anything>_w<N>_test`,
 * `<anything>_tmpl_test`, or a worker's extra `<anything>_w<N>_<extra>_test`.
 */
function isDerivedTestDbName(name) {
  return /_(w\d+|tmpl)(_[a-z0-9]{1,12})?_test$/.test(name);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every database ONE run (base `<root>_test`) owns: its template, its workers
 * and their extras — `^<root>_(w<N>|tmpl)(_<extra>)?_test$`.
 */
function runDbPattern(baseName) {
  const root = assertTestName(baseName).slice(0, -TEST_SUFFIX.length);
  return new RegExp(`^${escapeRe(root)}_(w\\d+|tmpl)(_[a-z0-9]{1,${EXTRA_SUFFIX_MAX}})?_test$`);
}

/**
 * The two-key advisory lock for one base: [namespace, int32 hash of the name].
 * Different bases (repos, branches) no longer serialise on one global key;
 * two runs of the SAME base still do.
 */
function setupLockKeys(baseName) {
  const h = crypto.createHash('sha1').update(String(baseName)).digest();
  return [LOCK_NAMESPACE, h.readInt32BE(0)];
}

module.exports = {
  PRODUCT,
  LEGACY_PREFIX,
  DEFAULT_TEST_DATABASE_URL,
  EXTRA_SUFFIX_MAX,
  INFIX_RESERVE,
  slugify,
  productPrefix,
  branchSlug,
  worktreeSlug,
  testScope,
  scopedTestDbName,
  e2eTestDbName,
  envFileValues,
  fileEnvValue,
  resolveTestBaseUrl,
  baseTestUrl,
  workerDbUrl,
  extraTestDbUrl,
  createExtraTestDb,
  templateDbName,
  adminDbUrl,
  isDerivedTestDbName,
  runDbPattern,
  setupLockKeys,
};
