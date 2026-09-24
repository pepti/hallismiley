// The readiness checks behind GET /ready and GET /api/v1/admin/events/health.
//
// One computation, two audiences (2026-09-23): the public /ready answers the
// verdict to anyone and the `checks` detail only to a /metrics-credentialed
// caller (internalsDenied in server/app.js); the admin Monitoring screen reads
// the full report through the admin-gated events router. Moved here from the
// /ready handler unchanged, so both answer from the same code.
//
// The database module is required lazily, as the handler always did, so a
// database module that fails to load cannot take the probe down with it.
const { dbCircuitBreaker } = require('./circuitBreaker');
const { healthCheckFailed } = require('./alerts');
const { readMemory } = require('./memoryUsage');

function measureEventLoopLag() {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    setImmediate(() => resolve(Number(process.hrtime.bigint() - start) / 1e6));
  });
}

/** @returns {Promise<{ ok: boolean, checks: object }>} */
async function runReadinessChecks() {
  const { query: dbQuery, pool } = require('../config/database');
  const checks = {};
  let ok = true;

  // DB connectivity
  try {
    await Promise.race([
      dbQuery('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    checks.database = { status: 'ok' };
  } catch (err) {
    checks.database = { status: 'error', message: err.message };
    ok = false;
    healthCheckFailed('database', { message: err.message });
  }

  // DB pool health
  checks.dbPool = {
    status:  pool.waitingCount > 5 ? 'degraded' : 'ok',
    total:   pool.totalCount,
    idle:    pool.idleCount,
    waiting: pool.waitingCount,
  };
  if (pool.waitingCount > 5) ok = false;

  // Circuit breaker state
  checks.circuitBreaker = {
    status: dbCircuitBreaker.state === 'closed' ? 'ok' : 'degraded',
    state:  dbCircuitBreaker.state,
  };
  if (dbCircuitBreaker.state === 'open') ok = false;

  // Memory usage — reported for visibility; does not flip readiness. Reading
  // comes from memoryUsage.js, shared with the periodic alert so the two can
  // never disagree again (both once used heapUsed/heapTotal, which V8 grows on
  // demand — see that module's header). Ported from icelandicstore #180.
  const mem = readMemory();
  checks.memory = {
    status:      mem.heapRatio > 0.9 ? 'critical' : mem.heapRatio > 0.8 ? 'degraded' : 'ok',
    heapUsedMb:  mem.heapUsedMb,
    heapLimitMb: mem.heapLimitMb,
    rssMb:       mem.rssMb,
    ratio:       mem.ratioPct,
  };

  // Event loop lag — reported for visibility; does not flip readiness.
  // Short-lived spikes (GC, test noise) shouldn't evict the pod from the LB.
  const lagMs = await measureEventLoopLag();
  checks.eventLoop = {
    status: lagMs > 100 ? 'degraded' : 'ok',
    lagMs:  Math.round(lagMs),
  };

  return { ok, checks };
}

/** The response body both routes send; `withChecks` decides the detail. */
function readinessBody({ ok, checks }, withChecks) {
  return {
    status:    ok ? 'ok' : 'degraded',
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    ...(withChecks ? { checks } : {}),
  };
}

module.exports = { runReadinessChecks, readinessBody };
