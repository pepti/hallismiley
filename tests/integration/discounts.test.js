// Integration tests for the discount subsystem: the admin discount API
// (list/create/update + validation + RBAC), the Discount model, and the public
// code-preview endpoint that runs the engine against real Postgres.
// CSRF is bypassed in test mode (see tests/env.js), like the other admin specs.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser,
  createTestModeratorUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

let adminCookie, adminId, modId;

beforeEach(async () => {
  await cleanTables();
  // discounts isn't in the helper truncate list — clear it so codes (which carry
  // a unique index on LOWER(code)) don't collide across tests.
  await db.query('DELETE FROM discounts');
  adminId     = await createTestAdminUser();
  modId       = await createTestModeratorUser();
  adminCookie = await getTestSessionCookie(adminId);
});

// Create a discount through the admin API and return the created row.
async function createDiscount(overrides = {}) {
  const res = await request(app)
    .post('/api/v1/admin/discounts')
    .set('Cookie', adminCookie)
    .send({ code: 'SAVE10', value_type: 'percentage', value: 10, ...overrides });
  return res;
}

// ── RBAC / auth on the admin API ─────────────────────────────────────────────

describe('GET /api/v1/admin/discounts — access control', () => {
  test('admin can list discounts', async () => {
    const res = await request(app).get('/api/v1/admin/discounts').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.discounts)).toBe(true);
  });

  test('moderator (no discounts view) is forbidden — 403', async () => {
    const c = await getTestSessionCookie(modId);
    expect((await request(app).get('/api/v1/admin/discounts').set('Cookie', c)).status).toBe(403);
  });

  test('unauthenticated — 401', async () => {
    expect((await request(app).get('/api/v1/admin/discounts')).status).toBe(401);
  });
});

// ── create + validation ──────────────────────────────────────────────────────

describe('POST /api/v1/admin/discounts', () => {
  test('creates a percentage discount → 201', async () => {
    const res = await createDiscount();
    expect(res.status).toBe(201);
    expect(res.body.discount).toMatchObject({ code: 'SAVE10', value_type: 'percentage', value: 10 });
    expect(res.body.discount.id).toBeTruthy();
    // title defaults to the code when omitted.
    expect(res.body.discount.title).toBe('SAVE10');
  });

  test('creates a free-shipping discount → 201', async () => {
    const res = await createDiscount({ code: 'FREESHIP', type: 'free_shipping', value_type: 'fixed', value: 0 });
    expect(res.status).toBe(201);
    expect(res.body.discount.type).toBe('free_shipping');
  });

  test('missing code → 400', async () => {
    const res = await request(app).post('/api/v1/admin/discounts')
      .set('Cookie', adminCookie).send({ value_type: 'percentage', value: 10 });
    expect(res.status).toBe(400);
  });

  test('percentage value over 100 → 400', async () => {
    const res = await createDiscount({ code: 'TOOBIG', value: 150 });
    expect(res.status).toBe(400);
  });

  test('invalid value_type → 400', async () => {
    const res = await createDiscount({ code: 'BADTYPE', value_type: 'bogus' });
    expect(res.status).toBe(400);
  });

  test('duplicate code (case-insensitive unique) → 409', async () => {
    expect((await createDiscount({ code: 'DUP' })).status).toBe(201);
    const dup = await createDiscount({ code: 'dup' });
    expect(dup.status).toBe(409);
  });

  test('moderator cannot create — 403', async () => {
    const c = await getTestSessionCookie(modId);
    const res = await request(app).post('/api/v1/admin/discounts')
      .set('Cookie', c).send({ code: 'X', value_type: 'percentage', value: 10 });
    expect(res.status).toBe(403);
  });
});

// ── update ───────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/discounts/:id', () => {
  test('updates an existing discount → 200', async () => {
    const { body } = await createDiscount();
    const res = await request(app)
      .patch(`/api/v1/admin/discounts/${body.discount.id}`)
      .set('Cookie', adminCookie)
      .send({ value: 25, enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.discount.value).toBe(25);
    expect(res.body.discount.enabled).toBe(false);
  });

  test('non-existent id → 404', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/discounts/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ value: 5 });
    expect(res.status).toBe(404);
  });

  test('invalid partial body → 400', async () => {
    const { body } = await createDiscount();
    const res = await request(app)
      .patch(`/api/v1/admin/discounts/${body.discount.id}`)
      .set('Cookie', adminCookie)
      .send({ value_type: 'nope' });
    expect(res.status).toBe(400);
  });

  test('created discount appears in the list', async () => {
    await createDiscount({ code: 'LISTME' });
    const res = await request(app).get('/api/v1/admin/discounts').set('Cookie', adminCookie);
    expect(res.body.discounts.map(d => d.code)).toContain('LISTME');
  });
});

// ── public preview (POST /api/v1/shop/discounts/validate) ────────────────────

describe('POST /api/v1/shop/discounts/validate', () => {
  test('valid code returns the computed amount', async () => {
    await createDiscount({ code: 'TENOFF', value: 10 });
    const res = await request(app)
      .post('/api/v1/shop/discounts/validate')
      .send({ code: 'TENOFF', subtotal: 10000, currency: 'ISK' });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(1000);
    expect(res.body.freeShipping).toBe(false);
  });

  test('unknown code → 404 valid:false', async () => {
    const res = await request(app)
      .post('/api/v1/shop/discounts/validate')
      .send({ code: 'GHOST', subtotal: 10000 });
    expect(res.status).toBe(404);
    expect(res.body.valid).toBe(false);
  });

  test('expired code → 422', async () => {
    await createDiscount({ code: 'EXPIRED', ends_at: '2000-01-01T00:00:00.000Z' });
    const res = await request(app)
      .post('/api/v1/shop/discounts/validate')
      .send({ code: 'EXPIRED', subtotal: 10000 });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('expired');
  });
});
