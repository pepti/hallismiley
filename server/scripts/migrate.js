// Versioned migration runner.
// Applies pending migrations from server/config/schema.js and records them in
// the schema_migrations table so each migration only ever runs once.
//
// Run standalone: node server/scripts/migrate.js
// Called on deploy: imported and invoked by server/server.js before app.listen
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const { pool } = require('../config/database');
const { migrations } = require('../config/schema');

// Arbitrary but fixed key for the session-level advisory lock. Any process
// running this runner against the same database contends on it.
const MIGRATION_LOCK_ID = 725_100_318;

async function migrate() {
  const client = await pool.connect();
  let lockHeld = false;
  try {
    // ── Serialise concurrent runners ────────────────────────────────────────
    // Since PROD moved to a tier with deployment slots, two containers can boot
    // at once against the SAME database: the staging slot warming up while the
    // production slot still serves. Both call this runner. Without a lock they
    // race — the "already applied?" SELECT can pass in both before either
    // INSERT lands, so a migration runs twice (its second run failing on an
    // existing object and crash-looping the new container).
    //
    // pg_advisory_lock is session-scoped, so it is held across the per-migration
    // transactions below and released by the explicit unlock (or automatically
    // if the connection dies). The second booter simply waits here, then finds
    // everything applied and continues.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    lockHeld = true;

    // Ensure the tracking table exists before anything else
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of migrations) {
      const { rows } = await client.query(
        'SELECT name FROM schema_migrations WHERE name = $1',
        [migration.name]
      );
      if (rows.length > 0) {
        continue; // already applied
      }

      // One transaction per migration, covering the bookkeeping row: a migration
      // that fails half-way must leave no trace, or the next boot replays its
      // already-applied statements and crash-loops the deploy. Postgres runs DDL
      // transactionally, and no migration here uses a statement that cannot run
      // inside a transaction block (CREATE INDEX CONCURRENTLY, VACUUM).
      await client.query('BEGIN');
      try {
        for (const sql of migration.statements) {
          await client.query(sql);
        }
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [migration.name]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        err.message = `migration ${migration.name} failed and was rolled back: ${err.message}`;
        throw err;
      }
      console.log(`[migrate] Applied: ${migration.name}`);
    }

    console.log('[migrate] All migrations up to date.');
  } finally {
    // Release before returning the connection to the pool: a pooled connection
    // is reused, and a session-level advisory lock left held would travel with
    // it and deadlock the next boot.
    if (lockHeld) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      } catch (err) {
        console.warn(`[migrate] advisory unlock failed: ${err.message}`);
      }
    }
    client.release();
  }
}

module.exports = { migrate };

// When invoked directly: node server/scripts/migrate.js
if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(err => { console.error('Migration failed:', err.message); process.exit(1); });
}
