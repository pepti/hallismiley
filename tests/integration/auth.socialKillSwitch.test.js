// Social login (Google + Facebook) is LIVE on this site, so the routes stay
// open by default — the kill-switch (server/routes/authRoutes.js, ported from
// icelandicstore #153 with the default inverted) 404s all four OAuth routes
// only when SOCIAL_LOGIN_ENABLED=false is set explicitly. This suite pins both
// sides of that contract; the gate reads the env per-request, so it can be
// flipped inside one process.

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

  test.each(ROUTES)('GET %s is NOT gated by default (stays live)', async (route) => {
    delete process.env.SOCIAL_LOGIN_ENABLED;
    const res = await request(app).get(route);
    // Not the gate's 404 envelope. The unconfigured providers answer with
    // their own redirect/error — anything but the kill-switch shape.
    expect(res.status).not.toBe(404);
  });

  test.each(ROUTES)('GET %s returns the 404 envelope when switched off', async (route) => {
    process.env.SOCIAL_LOGIN_ENABLED = 'false';
    const res = await request(app).get(route);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found', code: 404 });
  });
});
