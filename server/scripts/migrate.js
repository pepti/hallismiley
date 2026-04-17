// Versioned migration runner.
// Applies pending migrations from server/config/schema.js and records them in
// the schema_migrations table so each migration only ever runs once.
//
// Run standalone:      node server/scripts/migrate.js
// Preview without DDL: node server/scripts/migrate.js --dry-run
// Called on deploy:    imported and invoked by server/server.js before app.listen
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/database');
const { migrations } = require('../config/schema');

/**
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] — when true, lists pending migrations without
 *                                  executing any DDL. No state is recorded.
 */
async function migrate(opts = {}) {
  const dryRun = !!opts.dryRun;
  const client = await pool.connect();
  try {
    // Ensure the tracking table exists before anything else (read-only side
    // effect: safe under --dry-run too, since production already has it).
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    const pending = [];

    for (const migration of migrations) {
      const { rows } = await client.query(
        'SELECT name FROM schema_migrations WHERE name = $1',
        [migration.name]
      );
      if (rows.length > 0) {
        continue; // already applied
      }

      pending.push(migration);

      if (dryRun) continue;

      for (const sql of migration.statements) {
        await client.query(sql);
      }
      await client.query(
        'INSERT INTO schema_migrations (name) VALUES ($1)',
        [migration.name]
      );
      console.log(`[migrate] Applied: ${migration.name}`);
    }

    if (dryRun) {
      if (pending.length === 0) {
        console.log('[migrate] --dry-run: no pending migrations.');
      } else {
        console.log(`[migrate] --dry-run: ${pending.length} pending:`);
        for (const m of pending) {
          console.log(`  - ${m.name}  (${m.statements.length} statement${m.statements.length === 1 ? '' : 's'})`);
        }
      }
    } else {
      console.log('[migrate] All migrations up to date.');
    }

    return pending.map((m) => m.name);
  } finally {
    client.release();
  }
}

module.exports = { migrate };

// When invoked directly: node server/scripts/migrate.js [--dry-run]
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  migrate({ dryRun })
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
}
