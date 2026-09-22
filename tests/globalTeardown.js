// Runs once after all test suites complete (forceExit in jest.config.js
// handles open handles).
//
// Drops the databases this run provisioned — the per-branch template and the
// per-worker clones (see tests/workerDb.js for the naming) — so scoped test
// databases do not pile up one set per branch. They are rebuilt from scratch
// by globalSetup on every run anyway, so nothing is lost. Opt out with
// KEEP_TEST_DB=1 when you want to inspect a worker database after a failure.
// A run killed before it gets here leaves its set behind: `npm run
// test:db:clean` drops the orphans.
const { Pool } = require('pg');
const { baseTestUrl, workerDbUrl, templateDbName, adminDbUrl } = require('./workerDb');

module.exports = async function globalTeardown(globalConfig) {
  // globalSetup pinned the resolved base into TEST_DATABASE_URL, so this
  // resolves to the same names it created.
  const baseUrl = baseTestUrl();
  const dbName = new URL(baseUrl).pathname.replace(/^\//, '');
  const workerCount = Math.max(1, globalConfig.maxWorkers || 1);
  const names = [templateDbName(dbName)];
  for (let i = 1; i <= workerCount; i++) names.push(workerDbUrl(i, baseUrl).name);

  if (process.env.KEEP_TEST_DB) {
    process.stdout.write(`[jest] KEEP_TEST_DB set — keeping ${names.join(', ')}\n`);
    return;
  }

  const admin = new Pool({ connectionString: adminDbUrl(baseUrl) });
  try {
    for (const name of names) {
      await dropDatabase(admin, name);
    }
  } finally {
    await admin.end();
  }
};

// Same shape as globalSetup's dropAndCreate: workers are gone by now, but the
// app's fire-and-forget writes and the 1 s idle timeout can leave a backend
// or two behind, and pg_terminate_backend returns before they actually exit.
async function dropDatabase(client, dbName) {
  if (!/_test$/.test(dbName)) {
    throw new Error(`Refusing to drop DB "${dbName}" — name must end in _test for safety.`);
  }
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await client.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName]
    );
    try {
      await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      return;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && /being accessed by other users/i.test(err.message)) {
        await new Promise(r => setTimeout(r, 100 * attempt));
        continue;
      }
      // Cleanup must never turn a green run red: report and move on.
      process.stderr.write(`[jest] could not drop ${dbName}: ${err.message}\n`);
      return;
    }
  }
}
