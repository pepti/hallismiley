// Runs once before all test suites in the main Jest process.
// Creates the test database schema using the shared DDL from server/config/schema.js
// so prod and test always stay in sync automatically.
const { Pool } = require('pg');
const { migrations } = require('../server/config/schema');

module.exports = async function globalSetup() {
  const dbUrl = process.env.TEST_DATABASE_URL
    || 'postgresql://postgres:postgres@localhost:5432/halliprojects_test';

  const pool   = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  try {
    for (const migration of migrations) {
      for (const sql of migration.statements) {
        await client.query(sql);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
};
