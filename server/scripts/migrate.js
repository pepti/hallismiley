// Versioned migration runner.
// Applies pending migrations from server/config/schema.js and records them in
// the schema_migrations table so each migration only ever runs once.
//
// Run standalone: node server/scripts/migrate.js
// Called on deploy: imported and invoked by server/server.js before app.listen
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../config/database');
const { migrations } = require('../config/schema');

async function migrate() {
  const client = await pool.connect();
  try {
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

      for (const sql of migration.statements) {
        await client.query(sql);
      }
      await client.query(
        'INSERT INTO schema_migrations (name) VALUES ($1)',
        [migration.name]
      );
      console.log(`[migrate] Applied: ${migration.name}`);
    }

    console.log('[migrate] All migrations up to date.');
  } finally {
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
