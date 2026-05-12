// Runs once before all test suites.
// Drops and recreates the test DB, then applies all migrations from scratch
// via the production migrate runner. Guarantees a deterministic clean slate
// every `npm test` — codifies what the team did manually before this fix.
const { Pool } = require('pg');

// Stable 32-bit key for pg_advisory_lock on the admin DB. Serialises
// concurrent globalSetup runs (e.g. an editor's auto-test + a pre-push)
// so the DROP/CREATE pair from one process can't interleave with another's,
// which used to crash with "duplicate key violates pg_database_datname_index"
// or leave the migration runner racing against a half-recreated DB.
const SETUP_LOCK_KEY = 0x68616c6c | 0; // ascii "hall" as int32

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
    // Acquire a session-scoped advisory lock so this whole DROP/CREATE block
    // runs sequentially even when two `npm test` processes race. The lock is
    // released automatically when the admin client returns to the pool below.
    const lockClient = await admin.connect();
    try {
      await lockClient.query('SELECT pg_advisory_lock($1)', [SETUP_LOCK_KEY]);
      try {
        await dropAndCreate(lockClient, dbName);
      } finally {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [SETUP_LOCK_KEY]);
      }
    } finally {
      lockClient.release();
    }
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

// Inner DROP/CREATE with retry: pg_terminate_backend returns immediately
// but the backend takes a moment to actually exit. DROP DATABASE will
// fail with "is being accessed by other users" if it sees those zombies,
// so we retry a few times with a short backoff.
async function dropAndCreate(client, dbName) {
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
      await client.query(`CREATE DATABASE "${dbName}"`);
      return;
    } catch (err) {
      const isAccessed = /being accessed by other users/i.test(err.message);
      const isDup      = /pg_database_datname_index/i.test(err.message);
      if (attempt < MAX_ATTEMPTS && (isAccessed || isDup)) {
        await new Promise(r => setTimeout(r, 100 * attempt));
        continue;
      }
      throw err;
    }
  }
}
