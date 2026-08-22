// Integration tests for the server-side event log behind Admin → Monitoring:
// the client error-toast beacon (POST /api/v1/events/collect), the admin read
// surface (GET /api/v1/admin/events) with its filters + paging, the model's
// input caps, and the retention prune.
//
// CSRF is bypassed under NODE_ENV=test (see server/middleware/csrf.js), so the
// beacon POSTs here carry no X-CSRF-Token — the browser client does send one.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const EventLog = require('../../server/models/EventLog');
const {
  createTestAdminUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

let adminCookie, userCookie, adminId, customerId;

// The beacon and the error handler both respond BEFORE their insert completes
// (a diagnostic write must never delay the response), so asserting straight
// after the request is a race. Poll for the expected row count instead.
async function waitForRows(expected, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const n = await EventLog.count({});
    if (n >= expected || Date.now() > deadline) return n;
    await new Promise(r => setTimeout(r, 25));
  }
}

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE event_logs RESTART IDENTITY CASCADE');
  adminId     = await createTestAdminUser();
  customerId  = await createTestRegularUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie  = await getTestSessionCookie(customerId);
});

// ── POST /api/v1/events/collect ───────────────────────────────────────────────

describe('POST /api/v1/events/collect', () => {
  test('records an anonymous client error and answers 204', async () => {
    const res = await request(app)
      .post('/api/v1/events/collect')
      .send({ message: 'Checkout failed', level: 'error', path: '/en/checkout', locale: 'en' });
    expect(res.status).toBe(204);

    expect(await waitForRows(1)).toBe(1);
    const rows = await EventLog.list({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'client', level: 'error', message: 'Checkout failed', path: '/en/checkout',
      user_id: null, username: null,
    });
    expect(rows[0].context).toMatchObject({ locale: 'en' });
  });

  test('attributes the row to the signed-in user (softAuth)', async () => {
    await request(app)
      .post('/api/v1/events/collect')
      .set('Cookie', userCookie)
      .send({ message: 'Could not add to cart', level: 'error', path: '/en/shop' })
      .expect(204);

    await waitForRows(1);
    const [row] = await EventLog.list({});
    expect(row.user_id).toBe(customerId);
    expect(row.username).toBeTruthy();
  });

  test('a client cannot forge a server-sourced row', async () => {
    await request(app)
      .post('/api/v1/events/collect')
      .send({ message: 'pretending to be the server', source: 'server', level: 'error' })
      .expect(204);

    await waitForRows(1);
    const [row] = await EventLog.list({});
    expect(row.source).toBe('client');
  });

  test('keeps the uncaught-error context (kind, where, stack)', async () => {
    await request(app)
      .post('/api/v1/events/collect')
      .send({
        message: 'x is not a function', level: 'error', path: '/en/shop', locale: 'en',
        context: {
          kind: 'uncaught',
          where: 'http://localhost/js/views/ShopView.js:42:7',
          stack: 'TypeError: x is not a function\n    at ShopView.render',
        },
      })
      .expect(204);

    await waitForRows(1);
    const [row] = await EventLog.list({});
    expect(row.context).toMatchObject({
      kind: 'uncaught', where: 'http://localhost/js/views/ShopView.js:42:7', locale: 'en',
    });
    expect(row.context.stack).toContain('ShopView.render');
  });

  test('an unknown kind falls back to toast, and unknown context fields are dropped', async () => {
    await request(app)
      .post('/api/v1/events/collect')
      .send({
        message: 'sneaky context',
        context: { kind: 'not-a-kind', evil: 'dropped', stack: 'ok' },
      })
      .expect(204);

    await waitForRows(1);
    const [row] = await EventLog.list({});
    expect(row.context.kind).toBe('toast');
    expect(row.context).not.toHaveProperty('evil');
  });

  test('an over-long stack is truncated, not rejected', async () => {
    await request(app)
      .post('/api/v1/events/collect')
      .send({ message: 'huge stack', context: { kind: 'uncaught', stack: 'z'.repeat(9000) } })
      .expect(204);

    await waitForRows(1);
    const [row] = await EventLog.list({});
    expect(row.context.stack).toHaveLength(1200);
  });

  test('an unknown level falls back to error, and an empty message is dropped', async () => {
    await request(app).post('/api/v1/events/collect')
      .send({ message: 'weird level', level: 'catastrophe' }).expect(204);
    await request(app).post('/api/v1/events/collect')
      .send({ message: '   ' }).expect(204);

    await waitForRows(1);
    const rows = await EventLog.list({});
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe('error');
  });
});

// ── GET /api/v1/admin/events ──────────────────────────────────────────────────

describe('GET /api/v1/admin/events', () => {
  beforeEach(async () => {
    await EventLog.record({ source: 'server', level: 'error', message: 'Regla timeout', path: 'POST /api/v1/admin/regla/invoice', status: 500 });
    await EventLog.record({ source: 'client', level: 'error', message: 'Checkout failed', path: '/en/checkout', userId: customerId, username: 'e2ecustomer' });
    await EventLog.record({ source: 'client', level: 'warn',  message: 'Slow response', path: '/en/shop' });
  });

  test('returns the paginated shape, newest first', async () => {
    const res = await request(app).get('/api/v1/admin/events').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, offset: 0 });
    expect(res.body.events).toHaveLength(3);
    expect(res.body.events[0].message).toBe('Slow response');   // most recent insert
  });

  test('401 without auth, 403 for a non-admin', async () => {
    await request(app).get('/api/v1/admin/events').expect(401);
    await request(app).get('/api/v1/admin/events').set('Cookie', userCookie).expect(403);
  });

  test('reports the real retention window so the UI need not hard-code it', async () => {
    const { RETENTION_DAYS } = require('../../server/services/eventLogCleanup');
    const res = await request(app).get('/api/v1/admin/events').set('Cookie', adminCookie);
    expect(res.body.retentionDays).toBe(RETENTION_DAYS);
    expect(res.body.retentionDays).toBeGreaterThan(0);
  });

  test('filters by source', async () => {
    const res = await request(app).get('/api/v1/admin/events?source=server').set('Cookie', adminCookie);
    expect(res.body.total).toBe(1);
    expect(res.body.events[0].message).toBe('Regla timeout');
  });

  test('filters by level', async () => {
    const res = await request(app).get('/api/v1/admin/events?level=warn').set('Cookie', adminCookie);
    expect(res.body.total).toBe(1);
    expect(res.body.events[0].message).toBe('Slow response');
  });

  test('search matches message, path and username', async () => {
    const byMessage = await request(app).get('/api/v1/admin/events?q=checkout').set('Cookie', adminCookie);
    expect(byMessage.body.total).toBe(1);

    const byUser = await request(app).get('/api/v1/admin/events?q=e2ecustomer').set('Cookie', adminCookie);
    expect(byUser.body.total).toBe(1);
    expect(byUser.body.events[0].username).toBe('e2ecustomer');
  });

  test('the count reflects the same filter as the rows (paging cannot lie)', async () => {
    const res = await request(app).get('/api/v1/admin/events?source=client&limit=1').set('Cookie', adminCookie);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.total).toBe(2);          // total is the FILTERED count, not 3
    expect(res.body.limit).toBe(1);
  });

  test('limit is clamped to 200', async () => {
    const res = await request(app).get('/api/v1/admin/events?limit=99999').set('Cookie', adminCookie);
    expect(res.body.limit).toBe(200);
  });
});

// ── Model behaviour ───────────────────────────────────────────────────────────

describe('EventLog model', () => {
  test('rejects an unknown source and an empty message', async () => {
    expect(await EventLog.record({ source: 'martian', message: 'nope' })).toBeNull();
    expect(await EventLog.record({ source: 'server', message: '' })).toBeNull();
    expect(await EventLog.count({})).toBe(0);
  });

  test('truncates an over-long message instead of failing the insert', async () => {
    const row = await EventLog.record({ source: 'server', message: 'x'.repeat(5000) });
    expect(row.message).toHaveLength(1000);
  });

  test('drops oversized context rather than storing broken JSON', async () => {
    const row = await EventLog.record({
      source: 'server', message: 'big context', context: { blob: 'y'.repeat(5000) },
    });
    expect(row.context).toEqual({});
  });

  test('survives a user being deleted — user_id nulls, username remains', async () => {
    await EventLog.record({ source: 'client', message: 'before deletion', userId: customerId, username: 'doomed' });
    await db.query('DELETE FROM users WHERE id = $1', [customerId]);
    const [row] = await EventLog.list({});
    expect(row.user_id).toBeNull();
    expect(row.username).toBe('doomed');
  });

  test('pruneOlderThan removes only rows past the window', async () => {
    await EventLog.record({ source: 'server', message: 'fresh' });
    await EventLog.record({ source: 'server', message: 'ancient' });
    await db.query(`UPDATE event_logs SET created_at = NOW() - INTERVAL '200 days' WHERE message = 'ancient'`);

    const removed = await EventLog.pruneOlderThan(90);
    expect(removed).toBe(1);
    const rows = await EventLog.list({});
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('fresh');
  });
});

// ── errorHandler capture ──────────────────────────────────────────────────────
// The handler records fire-and-forget (the response must not wait on a
// diagnostic write), so these poll briefly for the row instead of awaiting it.

describe('errorHandler → event log', () => {
  const errorHandler = require('../../server/middleware/errorHandler');

  const fakeReq = (over = {}) => ({
    method: 'POST', originalUrl: '/api/v1/shop/checkout',
    requestId: 'req-123', headers: { 'user-agent': 'JestAgent/1.0' },
    ...over,
  });
  const fakeRes = () => {
    const res = {};
    res.status = (code) => { res._status = code; return res; };
    res.json   = (body) => { res._body = body; return res; };
    return res;
  };

  let errSpy;
  beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => errSpy.mockRestore());

  test('records a 5xx, attributed to the signed-in user, with the stack in context', async () => {
    const err = new Error('Regla exploded');
    errorHandler(err, fakeReq({ user: { id: customerId, username: 'bob' } }), fakeRes(), () => {});
    expect(await waitForRows(1)).toBe(1);

    const [row] = await EventLog.list({});
    expect(row).toMatchObject({
      source: 'server', level: 'error', message: 'Regla exploded',
      path: 'POST /api/v1/shop/checkout', status: 500,
      user_id: customerId, username: 'bob', request_id: 'req-123',
    });
    expect(row.context.stack).toContain('Regla exploded');
  });

  test('ignores 4xx — routine client mistakes would bury the real failures', async () => {
    const err = new Error('Not found');
    err.status = 404;
    errorHandler(err, fakeReq(), fakeRes(), () => {});
    await new Promise(r => setTimeout(r, 250));
    expect(await EventLog.count({})).toBe(0);
  });

  test('still returns the generic 5xx envelope to the client', async () => {
    const res = fakeRes();
    errorHandler(new Error('leaky internal detail'), fakeReq(), res, () => {});
    expect(res._status).toBe(500);
    expect(res._body).toEqual({ error: 'Internal Server Error', code: 500 });
  });
});
