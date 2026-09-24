// PostgreSQL connection pool
// Uses a single pool shared across the app — pg manages idle/max connections automatically
const logger = require('../logger');
const { Pool } = require('pg');
const { dbQueryDuration } = require('../observability/metrics');
const { dbCircuitBreaker } = require('../observability/circuitBreaker');

// A query failure only counts against the circuit breaker when it means the
// database is unreachable — NOT when Postgres responded with an ordinary SQL
// error (constraint violation, syntax, statement_timeout). Otherwise a routine
// 23505 duplicate-key would trip the breaker. Everything else is treated as
// "DB is up" and resets the breaker.
const CONNECTIVITY_ERROR_CODES = new Set([
  // Node / libpq socket-level failures
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EPIPE',
  // PostgreSQL connection-exception class (08xxx) + admin/resource shutdowns
  '08000', '08003', '08006', '08001', '08004', '08007', '08P01',
  '57P01', '57P02', '57P03', '53300',
]);

function isConnectivityError(err) {
  if (!err) return false;
  // Only genuine "database is unreachable" signals trip the breaker — a real
  // DB-down surfaces as a socket error code (ECONNREFUSED/ETIMEDOUT/…) or an
  // 08xxx connection-class SQLSTATE. We deliberately do NOT trip on a codeless
  // pool-acquisition timeout ("timeout exceeded when trying to connect"): that
  // means the pool is saturated under load, not that the DB is down, and
  // shedding all traffic in that case would make a load spike worse.
  return !!(err.code && CONNECTIVITY_ERROR_CODES.has(err.code));
}

// Coarse, low-cardinality label for the query-duration histogram.
function queryVerb(text) {
  const m = /^\s*(\w+)/.exec(text || '');
  return m ? m[1].toLowerCase() : 'other';
}

// TLS to Postgres. Encrypted-by-default in production so a missing/mistyped
// DB_SSL can never silently downgrade the connection to plaintext; DB_SSL=true
// also forces it on in any environment (e.g. a hosted DB from local/dev).
// DB_SSL=false is an explicit opt-out for the rare DB with no TLS (NOT Azure —
// Azure Postgres requires it). rejectUnauthorized:true validates the server cert.
const useSSL = process.env.DB_SSL === 'true'
  || (process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: true } : false,
  max: 10,              // max connections in pool
  // Overridable for the test suite only: Jest gives every suite FILE its own
  // module registry and therefore its own pool, and since the per-worker-DB
  // rework four workers run suites concurrently. At the production 30s idle
  // timeout, finished suites' connections linger long enough that the sum
  // crosses Postgres's default max_connections=100 ("sorry, too many clients
  // already"). tests/env.js sets DB_POOL_IDLE_MS=1000 so a finished suite's
  // connections drop within a second. Production keeps 30s (warm connections).
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_MS || '30000', 10),
  connectionTimeoutMillis: 5000,
  // Idle TCP sockets on a cross-region DB get killed by NAT middleboxes;
  // keepalive keeps them warm so the next query doesn't re-handshake.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  statement_timeout: 15000,
});

// Fail fast on startup if DB is unreachable
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

// Thin wrapper — callers use query() and never touch the pool directly.
// (Wiring ported from icelandicstore: before it, the breaker and the query
// histogram were declared in observability/ but nothing ever fed them.)
// Also times the query (db_query_duration_seconds) and feeds the DB circuit
// breaker so it can actually open when the database becomes unreachable.
// NOTE: in-transaction queries run via pool.connect() → client.query() and do
// NOT pass through here, so they are not individually timed (see docs/SLO.md if present).
async function query(text, params) {
  const end = dbQueryDuration.startTimer({ query_name: queryVerb(text) });
  try {
    const result = await pool.query(text, params);
    dbCircuitBreaker.recordSuccess();
    return result;
  } catch (err) {
    if (isConnectivityError(err)) dbCircuitBreaker.recordFailure(err);
    else dbCircuitBreaker.recordSuccess(); // DB responded; just a SQL-level error
    throw err;
  } finally {
    end();
  }
}

// isConnectivityError is exported for unit testing of the circuit-breaker
// classification (it is otherwise an internal helper of query()).
module.exports = { query, pool, isConnectivityError };
