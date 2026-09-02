// In-app change-request tool: the environment gate on the submit endpoint and
// the admin switch that opens it up on PROD (ported from icelandicstore, ice #206).
//
// The widget was non-production-only (404 in production). It can now also be
// switched on for production from Admin → Feedback, but there it is admins
// only — a customer or a logged-out visitor must still get the same 404, so
// production never reveals the route.
//
// The gate resolves APP_ENV || NODE_ENV, and Jest runs with NODE_ENV=test,
// which would leave every door open. Every test therefore pins APP_ENV.
//
// NOTE: cleanTables() does not truncate app_settings, so the switch is cleared
// by hand between tests or it leaks into other suites.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

const ORIGINAL_APP_ENV = process.env.APP_ENV;
const setAppEnv = (v) => { process.env.APP_ENV = v; };

let adminCookie, userCookie, adminId, userId;

async function clearSettings() {
  await db.query("DELETE FROM app_settings WHERE key = 'change_requests.enabled'");
}

const ITEM = { page_url: '/is/', page_label: 'Home', note: 'Make the hero smaller' };

beforeEach(async () => {
  await cleanTables();
  await clearSettings();
  setAppEnv('production');
  adminId     = await createTestAdminUser();
  userId      = await createTestRegularUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie  = await getTestSessionCookie(userId);
});

afterAll(async () => {
  await clearSettings();
  if (ORIGINAL_APP_ENV === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = ORIGINAL_APP_ENV;
});

async function submit(cookie) {
  const req = request(app).post('/api/v1/change-requests').send({ items: [ITEM] });
  if (cookie) req.set('Cookie', cookie);
  return req;
}

async function enable(enabled) {
  return request(app)
    .patch('/api/v1/admin/change-requests/settings')
    .set('Cookie', adminCookie)
    .send({ enabled });
}

// ── POST /api/v1/change-requests ─────────────────────────────────────────────

describe('POST /api/v1/change-requests — environment gate', () => {
  test('404s in production while the switch is off, even for an admin', async () => {
    expect((await submit(null)).status).toBe(404);
    expect((await submit(userCookie)).status).toBe(404);
    expect((await submit(adminCookie)).status).toBe(404);
  });

  test('accepts anonymous submissions on TEST regardless of the switch', async () => {
    setAppEnv('test');
    const res = await submit(null);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, count: 1 });
  });

  test('once switched on in production, admins can submit', async () => {
    await enable(true);
    const res = await submit(adminCookie);
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(1);

    const { rows } = await db.query('SELECT page_label, note FROM change_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ page_label: 'Home', note: ITEM.note });
  });

  test('once switched on in production, customers and anonymous visitors still 404', async () => {
    await enable(true);
    expect((await submit(userCookie)).status).toBe(404);
    expect((await submit(null)).status).toBe(404);
    const { rows } = await db.query('SELECT id FROM change_requests');
    expect(rows).toHaveLength(0);
  });

  test('switching back off closes the door again', async () => {
    await enable(true);
    await enable(false);
    expect((await submit(adminCookie)).status).toBe(404);
  });
});

// ── Admin settings endpoints ─────────────────────────────────────────────────

describe('/api/v1/admin/change-requests/settings', () => {
  test('GET returns the default (off) plus the current appEnv', async () => {
    const res = await request(app)
      .get('/api/v1/admin/change-requests/settings')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, appEnv: 'production' });
  });

  test('PATCH persists the switch and GET reads it back', async () => {
    expect((await enable(true)).body).toMatchObject({ enabled: true });
    const res = await request(app)
      .get('/api/v1/admin/change-requests/settings')
      .set('Cookie', adminCookie);
    expect(res.body.enabled).toBe(true);
  });

  test('PATCH rejects a non-boolean', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/change-requests/settings')
      .set('Cookie', adminCookie)
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  test('non-admins cannot read or write the switch', async () => {
    expect((await request(app).get('/api/v1/admin/change-requests/settings')
      .set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).patch('/api/v1/admin/change-requests/settings')
      .set('Cookie', userCookie).send({ enabled: true })).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/change-requests/settings')).status).toBe(401);
  });
});

// ── The switch stays off the public surface ──────────────────────────────────

describe('GET /api/v1/shop/config', () => {
  test('does not leak the change-request switch to anonymous callers', async () => {
    await enable(true);
    const res = await request(app).get('/api/v1/shop/config');
    expect(res.status).toBe(200);
    // The widget reads the admin-only settings endpoint instead — whether the
    // owner is collecting change requests is not public information.
    expect(res.body.changeRequests).toBeUndefined();
  });
});
