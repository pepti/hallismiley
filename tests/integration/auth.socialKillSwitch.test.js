// Social login ships OFF here — no OAuth app is configured for Orange Smiley —
// so the kill-switch (server/routes/authRoutes.js, ported from icelandicstore
// #153 with the default INVERTED for this repo) 404s all four OAuth routes
// unless SOCIAL_LOGIN_ENABLED=true is set explicitly. This suite pins both
// sides of that contract: closed by default, and genuinely open when switched
// on. The gate reads the env per-request, so it can be flipped in one process.

const request = require('supertest');
const app = require('../../server/app');

const ROUTES = [
  '/auth/google',
  '/auth/google/callback',
  '/auth/facebook',
  '/auth/facebook/callback',
];

describe('social login kill-switch', () => {
  afterEach(() => {
    delete process.env.SOCIAL_LOGIN_ENABLED;
  });

  test.each(ROUTES)('GET %s is gated by default (ships OFF here)', async (route) => {
    delete process.env.SOCIAL_LOGIN_ENABLED;
    const res = await request(app).get(route);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found', code: 404 });
  });

  test.each(ROUTES)('GET %s opens up when switched ON explicitly', async (route) => {
    process.env.SOCIAL_LOGIN_ENABLED = 'true';
    const res = await request(app).get(route);
    // What answers depends on provider config (a redirect to Google, or the
    // controller's own error) — the contract under test is only that the gate
    // is no longer swallowing the route with the not-found envelope.
    expect(res.status).not.toBe(404);
    expect(res.body).not.toEqual({ error: 'Not found', code: 404 });
  });
});
