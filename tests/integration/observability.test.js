'use strict';

/**
 * Observability endpoint tests — /health, /ready, /metrics.
 * Verifies that monitoring probes work correctly under test conditions.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');

afterAll(async () => {
  await db.pool.end();
});

// ── GET /health — liveness probe ──────────────────────────────────────────────

describe('GET /health (liveness probe)', () => {
  test('returns 200 with status ok, uptime, and timestamp', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status:    'ok',
      uptime:    expect.any(Number),
      timestamp: expect.any(String),
    });
  });

  test('uptime is a non-negative number', async () => {
    const res = await request(app).get('/health');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  test('timestamp is a valid ISO 8601 string', async () => {
    const res = await request(app).get('/health');
    expect(() => new Date(res.body.timestamp)).not.toThrow();
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  test('attaches X-Request-ID header to every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ── GET /ready — readiness probe ──────────────────────────────────────────────

describe('GET /ready (readiness probe)', () => {
  test('returns 200 with status ok in healthy test environment', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('response includes uptime and timestamp', async () => {
    const res = await request(app).get('/ready');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });

  test('database check reports ok when DB is reachable', async () => {
    const res = await request(app).get('/ready');
    expect(res.body.checks).toHaveProperty('database');
    expect(res.body.checks.database.status).toBe('ok');
  });

  test('dbPool check is included in response', async () => {
    const res = await request(app).get('/ready');
    expect(res.body.checks).toHaveProperty('dbPool');
    expect(res.body.checks.dbPool).toHaveProperty('total');
    expect(res.body.checks.dbPool).toHaveProperty('idle');
    expect(res.body.checks.dbPool).toHaveProperty('waiting');
  });

  test('memory check is included and reports ok', async () => {
    const res = await request(app).get('/ready');
    expect(res.body.checks).toHaveProperty('memory');
    // Under normal test conditions memory usage is well below 80% threshold
    expect(res.body.checks.memory.status).toBe('ok');
    expect(res.body.checks.memory).toHaveProperty('heapUsedMb');
    expect(res.body.checks.memory).toHaveProperty('heapTotalMb');
  });

  test('event loop check is included', async () => {
    const res = await request(app).get('/ready');
    expect(res.body.checks).toHaveProperty('eventLoop');
    expect(res.body.checks.eventLoop).toHaveProperty('lagMs');
  });
});

// ── GET /metrics — Prometheus endpoint ───────────────────────────────────────

describe('GET /metrics (Prometheus metrics endpoint)', () => {
  test('returns 200 with Prometheus text format when no auth token is configured', async () => {
    // METRICS_TOKEN is not set in test env — endpoint is open
    const original = process.env.METRICS_TOKEN;
    delete process.env.METRICS_TOKEN;
    try {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      // Prometheus text format includes HELP and TYPE comment lines
      expect(res.text).toMatch(/# (HELP|TYPE)/);
    } finally {
      if (original !== undefined) process.env.METRICS_TOKEN = original;
    }
  });

  test('returns 401 when a wrong bearer token is provided', async () => {
    const original = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = 'correct-secret';
    try {
      const res = await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer wrong-secret');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/unauthorized/i);
    } finally {
      process.env.METRICS_TOKEN = original;
    }
  });

  test('returns 200 with correct bearer token', async () => {
    const original = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = 'correct-secret';
    try {
      const res = await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer correct-secret');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/# (HELP|TYPE)/);
    } finally {
      process.env.METRICS_TOKEN = original;
    }
  });

  test('returns 401 when Authorization header is missing entirely and token is configured', async () => {
    const original = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = 'secret';
    try {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(401);
    } finally {
      process.env.METRICS_TOKEN = original;
    }
  });
});
