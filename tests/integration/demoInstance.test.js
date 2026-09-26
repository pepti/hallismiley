// The demo instance (R2b, D-020 — server/config/demoInstance.js): what changes
// when DEMO_INSTANCE=true, and that nothing changes when it is not. The reset
// itself — which DROPS a schema — is exercised on a database of its own in
// demoReset.test.js; here the route's reset must REFUSE (this worker database
// ends in _test), and the site must keep answering.
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const setEnv = (env) => {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
};

let adminCookie;
beforeAll(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie(await createTestAdminUser());
});

describe('not a demo instance (the default)', () => {
  test('robots, headers, the page and the admin route are as before', async () => {
    // As the public host: off it, robots.txt is Disallow: / anyway
    // (server/utils/indexability.js — supertest sends 127.0.0.1).
    const robots = await request(app).get('/robots.txt').set('Host', new URL(process.env.APP_URL).host);
    expect(robots.text).toContain('Disallow: /auth/');
    expect(robots.text).not.toMatch(/^Disallow: \/$/m);
    const page = await request(app).get('/is/');
    expect(page.headers['x-robots-tag']).toBeUndefined();
    expect(page.text).not.toContain('data-demo-instance');
    expect((await request(app).get('/api/v1/admin/demo').set('Cookie', adminCookie)).status).toBe(404);
  });
});

describe('a demo instance (DEMO_INSTANCE=true)', () => {
  let restore;
  beforeEach(() => { restore = setEnv({ DEMO_INSTANCE: 'true', DEMO_RESET_HOUR_UTC: undefined }); });
  afterEach(() => restore());

  test('crawlers are shut out: robots disallows everything, every response says noindex', async () => {
    const robots = await request(app).get('/robots.txt');
    expect(robots.text).toBe('User-agent: *\nDisallow: /\n');
    const page = await request(app).get('/is/');
    expect(page.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect((await request(app).get('/health')).status).toBe(200);
  });

  test('the page carries the banner hand-off with the reset hour (02:00 by default)', async () => {
    const page = await request(app).get('/is/');
    expect(page.text).toMatch(/<html [^>]*data-demo-instance="true" data-demo-reset-hour="2"/);
    const r = setEnv({ DEMO_RESET_HOUR_UTC: '5' });
    try {
      expect((await request(app).get('/is/')).text).toContain('data-demo-reset-hour="5"');
    } finally { r(); }
  });

  test('email, payments and MCP are off whatever the env holds', async () => {
    const r = setEnv({ RESEND_API_KEY: 're_test_not_real', STRIPE_SECRET_KEY: 'sk_test_not_real', MCP_ENABLED: 'true' });
    try {
      const email = require('../../server/services/emailService');
      expect(email.isConfigured()).toBe(false);
      const sent = await email.deliver({ from: 'a@example.is', to: ['someone@example.com'], subject: 's', html: '<p>x</p>' }, 'test');
      expect(sent).toEqual({ data: { id: null }, error: null });
      expect(require('../../server/config/stripe').isConfigured()).toBe(false);
      expect((await request(app).post('/api/v1/mcp').send({})).status).toBe(404);
      expect((await request(app).get('/.well-known/oauth-authorization-server')).status).toBe(404);
    } finally { r(); }
  });

  test('an admin sees the reset status; anyone else is refused', async () => {
    const res = await request(app).get('/api/v1/admin/demo').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.demo).toBe(true);
    expect(new Date(res.body.nextReset).getUTCHours()).toBe(2);
    expect(new Date(res.body.nextReset).getTime()).toBeGreaterThan(Date.now());
    expect((await request(app).get('/api/v1/admin/demo')).status).toBe(401);
    const userCookie = await getTestSessionCookie(await createTestRegularUser());
    expect([403, 404]).toContain((await request(app).get('/api/v1/admin/demo').set('Cookie', userCookie)).status);
  });

  test('the reset route checks before it answers: outside a demo environment it refuses with 409 and changes nothing', async () => {
    const before = await db.query('SELECT COUNT(*)::int AS n FROM users');
    const res = await request(app).post('/api/v1/admin/demo/reset').set('Cookie', adminCookie).send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 409, reason: 'refused' });
    expect(typeof res.body.error).toBe('string');
    const after = await db.query('SELECT COUNT(*)::int AS n FROM users');
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect((await request(app).get('/api/v1/admin/demo').set('Cookie', adminCookie)).status).toBe(200); // no 503 left behind
  });

  test('the reset refuses unless APP_ENV is exactly "demo" (unset reads as production)', async () => {
    const { resetDemo } = require('../../server/services/demoReset');
    for (const env of [undefined, 'production', 'test']) {
      const r = setEnv({ APP_ENV: env, NODE_ENV: env === undefined ? 'production' : process.env.NODE_ENV });
      try {
        await expect(resetDemo({ exit: false })).rejects.toThrow(/APP_ENV must be "demo"/);
      } finally { r(); }
    }
  });

  test('with APP_ENV=demo it still refuses unless DEMO_DATABASE_NAME names this database', async () => {
    const { resetDemo } = require('../../server/services/demoReset');
    let r = setEnv({ APP_ENV: 'demo', DEMO_DATABASE_NAME: undefined });
    try { await expect(resetDemo({ exit: false })).rejects.toThrow(/DEMO_DATABASE_NAME is not set/); } finally { r(); }
    r = setEnv({ APP_ENV: 'demo', DEMO_DATABASE_NAME: 'rekstrarkerfid_demo' });
    try { await expect(resetDemo({ exit: false })).rejects.toThrow(/but DEMO_DATABASE_NAME is "rekstrarkerfid_demo"/); } finally { r(); }
  });

  test('a misplaced flag fails the boot check', async () => {
    const { verifyDemoBoot } = require('../../server/services/demoReset');
    await expect(verifyDemoBoot()).rejects.toThrow(/APP_ENV must be "demo"/);
  });

  test('outside a demo instance the reset refuses outright and the boot check is a no-op', async () => {
    const r = setEnv({ DEMO_INSTANCE: undefined });
    try {
      const { resetDemo, verifyDemoBoot } = require('../../server/services/demoReset');
      await expect(resetDemo({ exit: false })).rejects.toThrow(/not a demo instance/);
      await expect(verifyDemoBoot()).resolves.toBe(false);
    } finally { r(); }
  });

  test('getStripe() refuses on a demo instance, key or not', () => {
    const r = setEnv({ STRIPE_SECRET_KEY: 'sk_test_not_real' });
    try {
      expect(() => require('../../server/config/stripe').getStripe()).toThrow(/off on a demo instance/);
    } finally { r(); }
  });
});
