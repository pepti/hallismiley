// PostgreSQL connection pool
// Uses a single pool shared across the app — pg manages idle/max connections automatically
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // On hosted services (Supabase, Railway, Render) SSL is required
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  max: 10,              // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Fail fast on startup if DB is unreachable
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// Thin wrapper — callers use query() and never touch the pool directly
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { query, pool };
