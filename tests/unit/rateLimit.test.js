/**
 * Rate-limiting behaviour tests.
 *
 * These tests spin up a purpose-built Express app with very low limits (max:3)
 * so we can trigger 429s without polluting the shared test DB pool or fighting
 * the app's test-mode skip flag.  No database access is required here.
 */
const request    = require('supertest');
const express    = require('express');
const rateLimit  = require('express-rate-limit');

function buildLimitedApp(max, windowMs = 60_000) {
  const app    = express();
  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    message: { error: 'Too many requests, please try again later.', code: 429 },
  });
  app.use(express.json());
  app.use(limiter);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  app.post('/data', (_req, res) => res.json({ ok: true }));
  return app;
}

// ── Global rate limiter behaviour ─────────────────────────────────────────────

describe('Rate limiter — 429 response', () => {
  test('first N requests succeed, (N+1)th is rejected with 429', async () => {
    const app = buildLimitedApp(3);

    // First 3 should succeed
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/ping');
      expect(res.status).toBe(200);
    }

    // 4th should be rate limited
    const blocked = await request(app).get('/ping');
    expect(blocked.status).toBe(429);
  });

  test('429 response body matches the configured error shape', async () => {
    const app     = buildLimitedApp(1);
    await request(app).get('/ping'); // consume the quota

    const blocked = await request(app).get('/ping');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      error: expect.stringMatching(/too many requests/i),
      code:  429,
    });
  });

  test('RateLimit-Limit and RateLimit-Remaining headers are present', async () => {
    const app = buildLimitedApp(5);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    // standardHeaders: true — RFC 6585 headers
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });

  test('RateLimit-Remaining decrements with each request', async () => {
    const app  = buildLimitedApp(5);
    const res1 = await request(app).get('/ping');
    const res2 = await request(app).get('/ping');

    const remaining1 = Number(res1.headers['ratelimit-remaining']);
    const remaining2 = Number(res2.headers['ratelimit-remaining']);
    expect(remaining2).toBeLessThan(remaining1);
  });

  test('POST requests are also subject to rate limiting', async () => {
    const app = buildLimitedApp(2);
    await request(app).post('/data').send({});
    await request(app).post('/data').send({});

    const blocked = await request(app).post('/data').send({});
    expect(blocked.status).toBe(429);
  });
});

// ── Auth-specific limiter (defined in authRoutes.js) ─────────────────────────
// We verify the auth limiter is wired (max=50 since the ×5 raise, ice #201) by inspecting the route
// definition — the behaviour itself is covered by the dedicated limiter tests above.

describe('Auth limiter — configuration check', () => {
  test('authRoutes applies a rate limiter to POST /login', () => {
    // Load the router and confirm it has middleware on the login route
    const authRouter = require('../../server/routes/authRoutes');
    const loginLayer = authRouter.stack.find(l => {
      const methods = l.route?.methods ?? {};
      return methods.post && l.route?.path === '/login';
    });
    expect(loginLayer).toBeDefined();
    // The route has middleware (at minimum: authLimiter + controller = 2 handlers)
    expect(loginLayer.route.stack.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Contact limiter (defined in contactRoutes.js) ────────────────────────────

describe('Contact limiter — configuration check', () => {
  test('contactRoutes applies a rate limiter to POST /', () => {
    const contactRouter = require('../../server/routes/contactRoutes');
    const postLayer = contactRouter.stack.find(l => {
      const methods = l.route?.methods ?? {};
      return methods.post && l.route?.path === '/';
    });
    expect(postLayer).toBeDefined();
    // contactLimiter + submit handler = 2 handlers
    expect(postLayer.route.stack.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Static-asset exemption on the global limiter ──────────────────────────────
// The global limiter is mounted before express.static and the /assets/* upload
// mounts, so without this exemption one page load spends ~120 requests on CSS,
// JS, fonts and scene renditions. See server/utils/staticAsset.js (ice #201).

describe('Static-asset exemption', () => {
  const { isStaticAsset } = require('../../server/utils/staticAsset');

  test.each([
    '/css/main.css',
    '/js/main.js',
    '/js/i18n/en.json',
    '/fonts/barlow-500.woff2',
    '/assets/iceland/thjonusta-1600.avif',
    '/assets/avatars/avatar-01.svg',
    '/favicon.svg',
    '/manifest.json',
    '/og-image.jpg',
  ])('exempts %s', (path) => {
    expect(isStaticAsset({ path })).toBe(true);
  });

  test.each([
    '/api/v1/shop/products',
    '/api/v1/admin/shop/products.json',
    '/api/v1/mcp',
    '/api/v1/admin/background/media', // the upload carve-out is METHOD-based in app.js, not a static path
    '/is/admin/shop/products',
    '/is/admin/shop/products/abc-123/edit',
    '/sitemap.xml',                       // dynamic + DB-backed, stays limited
    '/robots.txt',
    '/index.html',
    '/favicon.ico',                       // not a shipped root file
    '/',
  ])('does not exempt %s', (path) => {
    expect(isStaticAsset({ path })).toBe(false);
  });

  // Regression: ice's first draft of this predicate also matched on file
  // extension, which made every one of these a free pass around the global
  // limiter — express.static misses, ssrMeta bails on its own extension check,
  // and the caller gets an unlimited stream of cheap 404s. Match on location
  // only, so a static-looking suffix on a non-static path proves nothing.
  test.each([
    '/is/catalog.png',
    '/is/admin/shop/products.json',
    '/auth/check-email/someone@example.json',
    '/some/deep/path/style.css',
    '/assetsfoo/x.css',
  ])('does not exempt %s — a static-looking suffix is not a static path', (path) => {
    expect(isStaticAsset({ path })).toBe(false);
  });

  test('a skipped asset request does not consume the budget', async () => {
    const app = express();
    app.use(rateLimit({
      windowMs: 60_000,
      max: 2,
      standardHeaders: true,
      legacyHeaders: false,
      skip: isStaticAsset,
      message: { error: 'Too many requests, please try again later.', code: 429 },
    }));
    app.get('/css/main.css', (_req, res) => res.send('body{}'));
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    // Ten asset hits — none of them should count.
    for (let i = 0; i < 10; i++) {
      expect((await request(app).get('/css/main.css')).status).toBe(200);
    }

    // The full budget is still there for real requests.
    const first = await request(app).get('/ping');
    expect(first.status).toBe(200);
    expect(Number(first.headers['ratelimit-remaining'])).toBe(1);
    expect((await request(app).get('/ping')).status).toBe(200);
    expect((await request(app).get('/ping')).status).toBe(429);
  });
});
