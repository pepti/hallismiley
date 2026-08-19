// PostgreSQL connection pool
// Uses a single pool shared across the app — pg manages idle/max connections automatically
const { Pool } = require('pg');

// TLS to Postgres. Encrypted-by-default in production so a missing/mistyped
// DB_SSL can never silently downgrade the connection to plaintext; DB_SSL=true
// also forces it on in any environment (e.g. a hosted DB from local/dev).
// DB_SSL=false is an explicit opt-out for the rare DB with no TLS (NOT Azure —
// Azure Postgres requires it). rejectUnauthorized:true validates the server cert.
// Behavior-neutral for the live site: prod already sets DB_SSL=true
// (docs/DEPLOYMENT.md); this closes the silent-downgrade path if it were lost.
const useSSL = process.env.DB_SSL === 'true'
  || (process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: true } : false,
  max: 10,              // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Idle TCP sockets on a cross-region DB get killed by NAT middleboxes;
  // keepalive keeps them warm so the next query doesn't re-handshake.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  statement_timeout: 15000,
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
