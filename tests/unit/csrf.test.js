'use strict';

/**
 * Unit tests for CSRF double-submit cookie protection.
 * Tests the underlying doubleCsrfProtection middleware directly (not the
 * test-mode bypass wrapper) so that CSRF behaviour is actually exercised.
 * No database required.
 */
const request      = require('supertest');
const express      = require('express');
const cookieParser = require('cookie-parser');
const { doubleCsrf } = require('csrf-csrf');

// Build a minimal CSRF-protected Express app for testing
function buildCsrfApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
    getSecret:              () => 'test-csrf-secret-for-unit-tests',
    getSessionIdentifier:   () => 'test-session-id',
    cookieName:             'x-csrf-token',
    cookieOptions:          { httpOnly: true, sameSite: 'strict', secure: false, path: '/' },
    getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
    size:            64,
    ignoredMethods:  ['GET', 'HEAD', 'OPTIONS'],
  });

  // Endpoint to obtain a fresh CSRF token + cookie
  app.get('/csrf-token', (req, res) => {
    const token = generateCsrfToken(req, res);
    res.json({ token });
  });

  // A state-changing endpoint guarded by CSRF
  app.post('/protected', doubleCsrfProtection, (req, res) => {
    res.json({ ok: true });
  });

  // An idempotent endpoint — CSRF not applied (GET is ignored)
  app.get('/open', (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

describe('CSRF protection — double-submit cookie pattern', () => {
  test('POST without CSRF token is rejected', async () => {
    const app = buildCsrfApp();
    const res = await request(app).post('/protected').send({});
    // csrf-csrf returns 403 by default
    expect(res.status).toBe(403);
  });

  test('POST with stale/wrong token is rejected', async () => {
    const app = buildCsrfApp();
    const res = await request(app)
      .post('/protected')
      .set('x-csrf-token', 'not-a-real-token')
      .send({});
    expect(res.status).toBe(403);
  });

  test('POST with valid token and matching cookie is accepted', async () => {
    const agent = request.agent(buildCsrfApp());

    // Step 1: obtain the token (also sets the csrf cookie via Set-Cookie)
    const tokenRes = await agent.get('/csrf-token');
    expect(tokenRes.status).toBe(200);
    const { token } = tokenRes.body;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    // Step 2: submit to the protected endpoint with the token header
    const res = await agent
      .post('/protected')
      .set('x-csrf-token', token)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('GET requests are not CSRF-protected (ignoredMethods)', async () => {
    const app = buildCsrfApp();
    // No token or cookie provided — should still succeed because GET is ignored
    const res = await request(app).get('/open');
    expect(res.status).toBe(200);
  });

  test('token fetch endpoint (GET) works without any CSRF state', async () => {
    const app = buildCsrfApp();
    const res = await request(app).get('/csrf-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });
});
