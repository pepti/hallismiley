// Integration tests for the admin Customers area: list (users + order aggregates),
// add a passwordless customer (role server-set), and CSV import. CSRF is bypassed
// in test mode. Listing is gated by the 'customers' view; writes are admin-only.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser, createTestModeratorUser, createTestRegularUser,
  createTestPendingGuest, getTestSessionCookie, cleanTables,
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

  test('NEVER deletes party guests (their critical party data must survive); list flags them', async () => {
    // A pending party guest (requested_at set) and an approved one with access.
    const pending  = await createTestPendingGuest({ email: 'pg1@party.is', username: 'pg1' });
    const { rows: appr } = await db.query(
      `INSERT INTO users (email, username, password_hash, role, party_access, approval_status, requested_at, magic_login_token_hash)
       VALUES ('pg2@party.is', 'pg2', NULL, 'user', TRUE, 'approved', NOW(), 'hash-xyz') RETURNING id`
    );
    const approvedGuest = appr[0].id;
    // Give the approved guest an RSVP so we can prove it isn't cascade-deleted.
    await db.query(
      `INSERT INTO party_rsvps (user_id, attending, plus_one) VALUES ($1, TRUE, TRUE)`,
      [approvedGuest]
    );

    // The Customers list marks party guests so the client hides their checkbox;
    // a real shop customer is not flagged (stays deletable). Checked before the
    // delete, while all three rows still exist.
    const listed = await request(app).get('/api/v1/admin/customers').set('Cookie', adminCookie);
    const byId = new Map(listed.body.customers.map(c => [c.id, c.is_party_guest]));
    expect(byId.get(pending.id)).toBe(true);
    expect(byId.get(approvedGuest)).toBe(true);
    expect(byId.get(userId)).toBe(false);

    // Even explicitly targeting both guest ids deletes NEITHER.
    const res = await del(adminCookie, [pending.id, approvedGuest, userId]);
    expect(res.status).toBe(200);
    expect(res.body.deletedAccounts).toEqual([userId]); // only the plain shop customer

    const { rows: survivors } = await db.query('SELECT id FROM users WHERE id = ANY($1)', [[pending.id, approvedGuest]]);
    expect(survivors).toHaveLength(2);
    // The party RSVP is intact (would have cascade-deleted with the user).
    expect((await db.query('SELECT 1 FROM party_rsvps WHERE user_id = $1', [approvedGuest])).rows).toHaveLength(1);
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

describe('bulk welcome invites', () => {
  const previewUrl  = '/api/v1/admin/customers/send-invites/preview';
  const sendUrl     = '/api/v1/admin/customers/send-invites';
  const renderUrl   = '/api/v1/admin/customers/send-invites/render';
  const templateUrl = '/api/v1/admin/customers/invite-template';

  // A passwordless, approved shop customer — the canonical invite candidate.
  async function createCandidate(email) {
    const res = await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie).send({ email });
    expect(res.status).toBe(201);
    return res.body.customer.id;
  }

  test('preview lists candidates and excludes party guests, disabled and passworded users', async () => {
    const candidateId = await createCandidate('invitee@example.com');
    // Party guest: passwordless role=user but signs in via magic link.
    await db.query(
      `INSERT INTO users (email, username, password_hash, role, party_access)
       VALUES ('guest@party.is', 'partyguest1', NULL, 'user', TRUE)`
    );
    // Disabled passwordless customer.
    await db.query(
      `INSERT INTO users (email, username, password_hash, role, disabled)
       VALUES ('off@example.com', 'disabledcust', NULL, 'user', TRUE)`
    );
    // createTestRegularUser has a password — not a candidate either.

    const res = await request(app).get(previewUrl).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.candidates.map(c => c.id)).toEqual([candidateId]);
    expect(res.body.count).toBe(1);
    expect(res.body.emailConfigured).toBe(false); // no Resend in tests
    expect(res.body.template.en.subject).toBeTruthy();
    expect(res.body.defaults.is.subject).toBeTruthy();
  });

  test('send stamps invited_at + reset token, returns devLinks, and is idempotent', async () => {
    const candidateId = await createCandidate('invitee2@example.com');

    const res = await request(app).post(sendUrl).set('Cookie', adminCookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.devLinks).toHaveLength(1); // NODE_ENV=test → links surfaced
    expect(res.body.devLinks[0].link).toContain('/#/reset-password?token=');

    const { rows } = await db.query(
      'SELECT invited_at, password_reset_token FROM users WHERE id = $1', [candidateId]
    );
    expect(rows[0].invited_at).toBeTruthy();
    expect(rows[0].password_reset_token).toBeTruthy();

    // Everyone is now invited → a second run sends nothing.
    const again = await request(app).post(sendUrl).set('Cookie', adminCookie).send({});
    expect(again.body.sent).toBe(0);
  });

  test('recipientIds narrows the send; forged/stale ids are ignored; empty list sends none', async () => {
    const keepId   = await createCandidate('keep@example.com');
    const removeId = await createCandidate('removed@example.com');

    const res = await request(app).post(sendUrl).set('Cookie', adminCookie)
      .send({ recipientIds: [keepId, 'forged-id'] });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);

    const { rows } = await db.query('SELECT id, invited_at FROM users WHERE id = ANY($1)', [[keepId, removeId]]);
    const byId = new Map(rows.map(r => [r.id, r.invited_at]));
    expect(byId.get(keepId)).toBeTruthy();
    expect(byId.get(removeId)).toBeNull();

    const none = await request(app).post(sendUrl).set('Cookie', adminCookie).send({ recipientIds: [] });
    expect(none.body.sent).toBe(0);
  });

  test('render returns the preview HTML with a sample token; non-admin 403', async () => {
    const res = await request(app).post(renderUrl).set('Cookie', adminCookie)
      .send({ locale: 'is', subject: 'Halló', heading: 'Velkomin', body: 'Texti' });
    expect(res.status).toBe(200);
    expect(res.body.html).toContain('SAMPLE-PREVIEW-TOKEN');
    expect(res.body.html).toContain('Velkomin');

    const c = await getTestSessionCookie(userId);
    expect((await request(app).post(renderUrl).set('Cookie', c).send({})).status).toBe(403);
    expect((await request(app).get(previewUrl).set('Cookie', c)).status).toBe(403);
    expect((await request(app).post(sendUrl).set('Cookie', c).send({})).status).toBe(403);
  });

  test('template PATCH persists per locale, merges, clears on empty string, 400 on over-length', async () => {
    const saved = await request(app).patch(templateUrl).set('Cookie', adminCookie)
      .send({ is: { subject: 'Sérsniðið efni' } });
    expect(saved.status).toBe(200);
    expect(saved.body.template.is.subject).toBe('Sérsniðið efni');

    // Merge: editing EN leaves the IS override intact.
    const merged = await request(app).patch(templateUrl).set('Cookie', adminCookie)
      .send({ en: { heading: 'Custom heading' } });
    expect(merged.body.template.is.subject).toBe('Sérsniðið efni');
    expect(merged.body.template.en.heading).toBe('Custom heading');

    // Clearing falls back to the i18n default.
    const cleared = await request(app).patch(templateUrl).set('Cookie', adminCookie)
      .send({ is: { subject: '' } });
    expect(cleared.body.template.is.subject).not.toBe('Sérsniðið efni');

    const tooLong = await request(app).patch(templateUrl).set('Cookie', adminCookie)
      .send({ en: { subject: 'x'.repeat(201) } });
    expect(tooLong.status).toBe(400);

    // app_settings isn't truncated between tests — clear the EN override too so
    // template state can't leak into other suites/runs.
    await request(app).patch(templateUrl).set('Cookie', adminCookie).send({ en: { heading: '' } });
  });
});
