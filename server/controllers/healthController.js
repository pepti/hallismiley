'use strict';

const { healthCheckFailed } = require('../observability/alerts');
const { dbCircuitBreaker }  = require('../observability/circuitBreaker');

// ── GET /health — simple liveness probe ───────────────────────────────────────
function liveness(req, res) {
  res.status(200).json({
    status:    'ok',
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}

// ── GET /ready — readiness probe with DB + system health checks ───────────────
async function readiness(req, res) {
  const { query: dbQuery, pool } = require('../config/database');

  async function measureEventLoopLag() {
    return new Promise(resolve => {
      const start = process.hrtime.bigint();
      setImmediate(() => resolve(Number(process.hrtime.bigint() - start) / 1e6));
    });
  }

  const checks = {};
  let overallOk = true;

  // DB connectivity
  try {
    await Promise.race([
      dbQuery('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    checks.database = { status: 'ok' };
  } catch (err) {
    checks.database = { status: 'error', message: err.message };
    overallOk = false;
    healthCheckFailed('database', { message: err.message });
  }

  // DB pool health
  checks.dbPool = {
    status:  pool.waitingCount > 5 ? 'degraded' : 'ok',
    total:   pool.totalCount,
    idle:    pool.idleCount,
    waiting: pool.waitingCount,
  };
  if (pool.waitingCount > 5) overallOk = false;

  // Circuit breaker state
  checks.circuitBreaker = {
    status: dbCircuitBreaker.state === 'closed' ? 'ok' : 'degraded',
    state:  dbCircuitBreaker.state,
  };
  if (dbCircuitBreaker.state === 'open') overallOk = false;

  // Memory usage
  const mem = process.memoryUsage();
  const heapRatio = mem.heapUsed / mem.heapTotal;
  checks.memory = {
    status:      heapRatio > 0.9 ? 'critical' : heapRatio > 0.8 ? 'degraded' : 'ok',
    heapUsedMb:  Math.round(mem.heapUsed  / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    ratio:       `${(heapRatio * 100).toFixed(1)}%`,
  };
  if (heapRatio > 0.9) overallOk = false;

  // Event loop lag
  const lagMs = await measureEventLoopLag();
  checks.eventLoop = {
    status: lagMs > 100 ? 'degraded' : 'ok',
    lagMs:  Math.round(lagMs),
  };
  if (lagMs > 100) overallOk = false;

  const status = overallOk ? 200 : 503;
  res.status(status).json({
    status:    overallOk ? 'ok' : 'degraded',
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    checks,
  });
}

module.exports = { liveness, readiness };
