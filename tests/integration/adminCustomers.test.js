// Integration tests for the admin Customers area: list (users + order aggregates),
// add a passwordless customer (role server-set), and CSV import. CSRF is bypassed
// in test mode. Listing is gated by the 'customers' view; writes are admin-only.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser, createTestModeratorUser, createTestRegularUser,
  getTestSessionCookie, cleanTables,
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

describe('POST /api/v1/admin/customers/delete', () => {
  const del = (cookie, userIds) =>
    request(app).post('/api/v1/admin/customers/delete').set('Cookie', cookie).send({ userIds });

  test('deletes role=user accounts; orders are kept as guest records with identity backfilled', async () => {
    await db.query(
      `INSERT INTO orders (order_number, user_id, currency, subtotal, shipping, total, shipping_method)
       VALUES ('T-1001', $1, 'ISK', 1000, 0, 1000, 'local_pickup')`,
      [userId]
    );
    const res = await del(adminCookie, [userId]);
    expect(res.status).toBe(200);
    expect(res.body.accounts).toBe(1);
    expect(res.body.deletedAccounts).toEqual([userId]);

    expect((await db.query('SELECT 1 FROM users WHERE id = $1', [userId])).rows).toHaveLength(0);
    const { rows: orders } = await db.query(
      `SELECT user_id, guest_email, guest_name FROM orders WHERE order_number = 'T-1001'`
    );
    expect(orders).toHaveLength(1);
    expect(orders[0].user_id).toBeNull();
    expect(orders[0].guest_email).toBeTruthy(); // snapshotted from the deleted user
    // Sessions are gone (CASCADE + invalidate)
    expect((await db.query('SELECT 1 FROM user_sessions WHERE user_id = $1', [userId])).rows).toHaveLength(0);
  });

  test('silently skips staff accounts, multi-role holders and the acting admin (reported by absence)', async () => {
    const moderatorId = await createTestModeratorUser();
    const { rows: multi } = await db.query(
      `INSERT INTO users (email, username, password_hash, role)
       VALUES ('multi@example.com', 'multiuser', NULL, 'user') RETURNING id`
    );
    const multiRoleId = multi[0].id;
    await db.query(`INSERT INTO roles (name, view_access) VALUES ('helper', '[]'::jsonb) ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'helper')`, [multiRoleId]);
    const { rows: adminRows } = await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const adminId = adminRows[0].id;

    const res = await del(adminCookie, [moderatorId, multiRoleId, adminId, userId]);
    expect(res.status).toBe(200);
    expect(res.body.deletedAccounts).toEqual([userId]); // only the plain customer

    const { rows: kept } = await db.query('SELECT id FROM users WHERE id = ANY($1)', [[moderatorId, multiRoleId, adminId]]);
    expect(kept).toHaveLength(3);
  });

  test('400 on empty ids', async () => {
    expect((await del(adminCookie, [])).status).toBe(400);
  });

  test('400 on more than 100 ids', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect((await del(adminCookie, ids)).status).toBe(400);
  });

  test('regular user cannot delete — 403', async () => {
    const c = await getTestSessionCookie(userId);
    expect((await del(c, [userId])).status).toBe(403);
  });

  test('unauthenticated — 401', async () => {
    const res = await request(app).post('/api/v1/admin/customers/delete').send({ userIds: ['x'] });
    expect(res.status).toBe(401);
  });
});
