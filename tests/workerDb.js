// Per-worker test-database naming, shared by tests/env.js (runs in each Jest
// worker) and tests/globalSetup.js (runs once in the main process).
// Ported from icelandicstore (ice #225).
//
// Jest runs suites in parallel workers since the per-worker-DB rework, and the
// suites are provably unsafe against ONE shared database (fixed fixture ids,
// cleanTables()'s TRUNCATE … CASCADE, the app_settings singleton,
// migrateRunner touching schema_migrations). So every worker gets its own
// database, derived from TEST_DATABASE_URL by inserting the worker id BEFORE
// the `_test` suffix — `orangesmiley_test` → `orangesmiley_w2_test` — so
// the generated name still satisfies globalSetup's `_test$` safety guard.
// Within a worker, suites run serially: exactly the old semantics.
//
// No clash with the Playwright tier: e2e/lib/dbUrl.js derives
// `orangesmiley_e2e_<branch>_test`, a different infix.

const DEFAULT_TEST_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/orangesmiley_test';

function baseTestUrl() {
  return process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
}

/**
 * Returns { url, name } for the given 1-based worker id.
 * Throws if the base DB name does not end in `_test` (same safety contract
 * as globalSetup — never point workers at a non-test database).
 */
function workerDbUrl(workerId, base = baseTestUrl()) {
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '');
  if (!name || !/_test$/.test(name)) {
    throw new Error(
      `Refusing worker DB derivation from "${name}" — base name must end in _test.`
    );
  }
  const workerName = name.replace(/_test$/, `_w${workerId}_test`);
  url.pathname = `/${workerName}`;
  return { url: url.toString(), name: workerName };
}

module.exports = { workerDbUrl, baseTestUrl, DEFAULT_TEST_DATABASE_URL };
