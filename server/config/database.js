// PostgreSQL connection pool
// Uses a single pool shared across the app — pg manages idle/max connections automatically
const { Pool } = require('pg');
const logger = require('../observability/logger');
const { dbQueryDuration, dbPoolTotal, dbPoolIdle, dbPoolWaiting } = require('../observability/metrics');
const { dbCircuitBreaker } = require('../observability/circuitBreaker');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // On hosted services (Supabase, Railway, Render) SSL is required
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

/**
 * Instrumented query wrapper.
 * - Records query duration in Prometheus
 * - Logs slow queries (>500 ms) at warn level
 * - Updates the DB circuit breaker on success/failure
 * - Updates pool gauge metrics on every call
 *
 * @param {string} text       SQL query text
 * @param {any[]}  [params]   Query parameters
 * @param {string} [name]     Optional label for Prometheus (e.g. 'get_user_by_id')
 */
async function query(text, params, name) {
  // Update pool gauges (cheap, no extra network call)
  dbPoolTotal.set(pool.totalCount);
  dbPoolIdle.set(pool.idleCount);
  dbPoolWaiting.set(pool.waitingCount);

  const queryName  = name || 'unnamed';
  const startNs    = process.hrtime.bigint();

  try {
    const result     = await pool.query(text, params);
    const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;

    dbQueryDuration.observe({ query_name: queryName }, durationSec);

    if (durationSec > 0.5) {
      logger.warn(
        { queryName, durationMs: (durationSec * 1000).toFixed(1) },
        'Slow DB query detected',
      );
    }

    dbCircuitBreaker.recordSuccess();
    return result;
  } catch (err) {
    const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
    dbQueryDuration.observe({ query_name: queryName }, durationSec);
    dbCircuitBreaker.recordFailure(err);
    throw err;
  }
}

module.exports = { query, pool };
