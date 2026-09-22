// On Azure App Service `X-Forwarded-For` arrives as `ip:port`, which made every
// IP-keyed rate limiter key per TCP connection. These pin the normaliser and,
// end to end, that two connections from one address now share a bucket.
const express   = require('express');
const request   = require('supertest');
const rateLimit = require('express-rate-limit');
const { normalizeForwardedFor, stripPort } = require('../../server/middleware/forwardedFor');

describe('stripPort', () => {
  test.each([
    ['203.0.113.5:4711',        '203.0.113.5'],
    ['203.0.113.5',             '203.0.113.5'],
    ['[2001:db8::1]:4711',      '2001:db8::1'],
    ['2001:db8::1',             '2001:db8::1'],           // bare IPv6 — never touched
    ['[2001:db8::1]',           '[2001:db8::1]'],         // no port → not our pattern
    ['not-an-ip:1234',          'not-an-ip:1234'],        // unrecognised → untouched
    ['',                        ''],
  ])('%s → %s', (input, expected) => {
    expect(stripPort(input)).toBe(expected);
  });
});

function appWithLimiter() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(normalizeForwardedFor);
  app.use(rateLimit({ windowMs: 60_000, max: 1, standardHeaders: true, legacyHeaders: false }));
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe('normalizeForwardedFor', () => {
  test('req.ip is the bare address and two ports from one client share a bucket', async () => {
    const app = appWithLimiter();
    const first  = await request(app).get('/').set('Connection', 'close').set('X-Forwarded-For', '203.0.113.5:4711');
    const second = await request(app).get('/').set('Connection', 'close').set('X-Forwarded-For', '203.0.113.5:4712');
    expect(first.status).toBe(200);
    expect(first.body.ip).toBe('203.0.113.5');
    expect(second.status).toBe(429);                      // same bucket — the whole point
  });

  test('a different client is a different bucket', async () => {
    const app = appWithLimiter();
    await request(app).get('/').set('X-Forwarded-For', '203.0.113.5:4711');
    const other = await request(app).get('/').set('X-Forwarded-For', '203.0.113.6:4711');
    expect(other.status).toBe(200);
    expect(other.body.ip).toBe('203.0.113.6');
  });

  test('a proxy chain keeps its order and only loses ports', async () => {
    const app = express();
    app.use(normalizeForwardedFor);
    app.get('/', (req, res) => res.json({ xff: req.headers['x-forwarded-for'] }));
    const res = await request(app).get('/').set('X-Forwarded-For', '203.0.113.5:4711, 10.0.0.1, [2001:db8::2]:99');
    expect(res.body.xff).toBe('203.0.113.5, 10.0.0.1, 2001:db8::2');
  });

  test('a request with no header is untouched', async () => {
    const app = express();
    app.use(normalizeForwardedFor);
    app.get('/', (req, res) => res.json({ has: 'x-forwarded-for' in req.headers }));
    const res = await request(app).get('/');
    expect(res.body.has).toBe(false);
  });
});
