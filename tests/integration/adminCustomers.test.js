// Integration tests for the admin Customers area: list (users + order aggregates),
// add a passwordless customer (role server-set), and CSV import. CSRF is bypassed
// in test mode. Listing is gated by the 'customers' view; writes are admin-only.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

let adminCookie, userId;

beforeEach(async () => {
  await cleanTables();
  const adminId = await createTestAdminUser();
  userId        = await createTestRegularUser();
  adminCookie   = await getTestSessionCookie(adminId);
});

describe('GET /api/v1/admin/customers', () => {
  test('admin lists customers with order aggregates', async () => {
    const res = await request(app).get('/api/v1/admin/customers').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.customers)).toBe(true);
    expect(res.body.customers[0]).toHaveProperty('order_count');
    expect(res.body.customers[0]).toHaveProperty('total_spent');
  });

  test('regular user cannot list — 403', async () => {
    const c = await getTestSessionCookie(userId);
    expect((await request(app).get('/api/v1/admin/customers').set('Cookie', c)).status).toBe(403);
  });

  test('unauthenticated — 401', async () => {
    expect((await request(app).get('/api/v1/admin/customers')).status).toBe(401);
  });
});

describe('POST /api/v1/admin/customers', () => {
  test('creates a passwordless customer with role user (role never taken from body)', async () => {
    const res = await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie)
      .send({ email: 'New.Customer@Example.com', display_name: 'New Customer', phone: '555-0100', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.customer.role).toBe('user');
    // No mail transport in test env → an invite link is returned instead.
    expect(res.body.invited).toBe(false);
    expect(typeof res.body.resetUrl).toBe('string');

    const { rows } = await db.query(
      `SELECT role, password_hash, email_verified, display_name, phone, password_reset_token
         FROM users WHERE email = $1`,
      ['new.customer@example.com'] // stored lowercased
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('user');               // server-set, client 'admin' ignored
    expect(rows[0].password_hash).toBeNull();        // passwordless
    expect(rows[0].email_verified).toBe(false);
    expect(rows[0].display_name).toBe('New Customer');
    expect(rows[0].password_reset_token).toBeTruthy(); // invite token issued
  });

  test('409 on duplicate email', async () => {
    await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie).send({ email: 'dup@example.com' });
    const res = await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie).send({ email: 'dup@example.com' });
    expect(res.status).toBe(409);
  });

  test('400 on invalid email', async () => {
    const res = await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie).send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('regular user cannot create — 403', async () => {
    const c = await getTestSessionCookie(userId);
    const res = await request(app).post('/api/v1/admin/customers').set('Cookie', c).send({ email: 'x@example.com' });
    expect(res.status).toBe(403);
  });
});

describe('customer CSV import', () => {
  test('preview classifies new / existing / duplicate / invalid', async () => {
    await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie).send({ email: 'exists@example.com' });
    const rows = [
      { email: 'fresh@example.com' },   // new
      { email: 'exists@example.com' },  // existing
      { email: 'fresh@example.com' },   // duplicate within the file
      { email: 'bad' },                 // invalid
    ];
    const res = await request(app).post('/api/v1/admin/customers/import/preview').set('Cookie', adminCookie).send({ rows });
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ new: 1, existing: 1, duplicate: 1, invalid: 1 });
  });

  test('apply creates only new customers (role user, passwordless)', async () => {
    const rows = [
      { email: 'imp1@example.com', display_name: 'Imp One' },
      { email: 'imp2@example.com' },
      { email: 'bad' }, // invalid → skipped
    ];
    const res = await request(app).post('/api/v1/admin/customers/import').set('Cookie', adminCookie).send({ rows });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);

    const { rows: created } = await db.query(
      'SELECT role, password_hash FROM users WHERE email = ANY($1::text[])',
      [['imp1@example.com', 'imp2@example.com']]
    );
    expect(created).toHaveLength(2);
    expect(created.every(r => r.role === 'user' && r.password_hash === null)).toBe(true);
  });

  test('regular user cannot import — 403', async () => {
    const c = await getTestSessionCookie(userId);
    const res = await request(app).post('/api/v1/admin/customers/import').set('Cookie', c).send({ rows: [{ email: 'x@example.com' }] });
    expect(res.status).toBe(403);
  });
});
