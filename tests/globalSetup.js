// Runs once before all test suites.
// Drops and recreates the test DB, then applies all migrations from scratch
// via the production migrate runner. Guarantees a deterministic clean slate
// every `npm test` — codifies what the team did manually before this fix.
const { Pool } = require('pg');

module.exports = async function globalSetup() {
  const dbUrl = process.env.TEST_DATABASE_URL
    || 'postgresql://postgres:postgres@localhost:5432/hallismiley_test';

  const url    = new URL(dbUrl);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName || !/_test$/.test(dbName)) {
    throw new Error(
      `Refusing to drop DB "${dbName}" — name must end in _test for safety.`
    );
  }

  const adminUrl = new URL(dbUrl);
  adminUrl.pathname = '/postgres';

  const admin = new Pool({ connectionString: adminUrl.toString() });
  try {
    // Evict anything else on the DB (idle psql, IDE viewer, crashed Jest worker).
    await admin.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName]
    );
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  // server/config/database.js reads DATABASE_URL at require time, so set it
  // BEFORE requiring migrate.js. (tests/env.js sets it inside each worker;
  // globalSetup runs in the main Jest process, separately.)
  process.env.DATABASE_URL = dbUrl;
  const { migrate } = require('../server/scripts/migrate');
  const { pool }    = require('../server/config/database');
  try {
    await migrate();
  } finally {
    await pool.end();
  }
};
