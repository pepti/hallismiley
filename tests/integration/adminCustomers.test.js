// Integration tests for the admin Customers area: list (users + order aggregates),
// add a passwordless customer (role server-set), and CSV import. CSRF is bypassed
// in test mode. Listing is gated by the 'customers' view; writes are admin-only.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const adminCustomerController = require('../../server/controllers/adminCustomerController');
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

  test('a skipped multi-role account keeps a clean order history (no guest identity stamped)', async () => {
    // The guest_email/guest_name snapshot exists so a DELETED user's orders keep
    // a contact identity. It must never touch an account we then decline to
    // delete — a live customer whose orders carry a guest identity would show
    // that identity on delivery notes and order emails.
    const { rows: multi } = await db.query(
      `INSERT INTO users (email, username, password_hash, role, display_name)
       VALUES ('keeper@example.com', 'keeper', NULL, 'user', 'Keeper') RETURNING id`
    );
    const keeperId = multi[0].id;
    await db.query(`INSERT INTO roles (name, view_access) VALUES ('helper', '[]'::jsonb) ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'helper')`, [keeperId]);
    await db.query(
      `INSERT INTO orders (order_number, user_id, currency, subtotal, shipping, total, shipping_method)
       VALUES ('T-2002', $1, 'ISK', 1000, 0, 1000, 'local_pickup')`,
      [keeperId]
    );

    const res = await del(adminCookie, [keeperId]);
    expect(res.status).toBe(200);
    expect(res.body.deletedAccounts).toEqual([]); // skipped, as the guard intends

    const { rows: orders } = await db.query(
      `SELECT user_id, guest_email, guest_name FROM orders WHERE order_number = 'T-2002'`
    );
    expect(orders[0].user_id).toBe(keeperId); // still owned by the live account
    expect(orders[0].guest_email).toBeNull();
    expect(orders[0].guest_name).toBeNull();
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
    expect(res.body.maxPerRun).toBeGreaterThan(0); // how many one Send covers
    expect(res.body.template.en.subject).toBeTruthy();
    expect(res.body.defaults.is.subject).toBeTruthy();
  });

  test('a run reports what is still waiting (never silent truncation)', async () => {
    await createCandidate('cap1@example.com');
    await createCandidate('cap2@example.com');

    const res = await request(app).post(sendUrl).set('Cookie', adminCookie).send({});
    expect(res.status).toBe(200);
    // Both fit under the real cap, so everything drains and nothing is left.
    expect(res.body.sent).toBe(2);
    expect(res.body.remaining).toBe(0);

    // A second run has no candidates left — remaining stays 0, nothing re-sent.
    const again = await request(app).post(sendUrl).set('Cookie', adminCookie).send({});
    expect(again.body.sent).toBe(0);
    expect(again.body.remaining).toBe(0);
  });

  test('remaining counts candidates left after a partial (include-list) run', async () => {
    const a = await createCandidate('part1@example.com');
    await createCandidate('part2@example.com');
    // Admin removed the second recipient in the confirm panel — only `a` is sent.
    const res = await request(app).post(sendUrl).set('Cookie', adminCookie).send({ recipientIds: [a] });
    expect(res.body.sent).toBe(1);
    // The untouched candidate is still waiting and must be reported.
    expect(res.body.remaining).toBe(1);
  });

  test('in production an unconfigured mail transport fails the run instead of retiring candidates', async () => {
    // Outside production a missing transport is normal (we hand back devLinks and
    // stamp invited_at). In production there is no such fallback, so stamping
    // would drop these users out of the candidate set for good — with no email
    // ever delivered and no link to recover. The run must refuse instead.
    // Driven straight at the controller: flipping NODE_ENV around a supertest
    // request also flips the auth/CSRF middleware and yields a 403 before the
    // handler is reached, which would test nothing.
    const candidateId = await createCandidate('prodfail@example.com');
    const { rows: before } = await db.query(
      'SELECT password_reset_token FROM users WHERE id = $1', [candidateId]
    );
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let status = null, body = null;
    try {
      const res = {
        status(c) { status = c; return this; },
        json(b)   { body = b;  return this; },
      };
      await adminCustomerController.sendBulkInvites({ body: {}, locale: 'en' }, res, (err) => { throw err; });
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
    expect(status).toBe(503);
    expect(body.code).toBe(503);

    // Still a candidate: nothing stamped, and the reset token the account already
    // had is left alone rather than churned for a send that never happened.
    const { rows } = await db.query(
      'SELECT invited_at, password_reset_token FROM users WHERE id = $1', [candidateId]
    );
    expect(rows[0].invited_at).toBeNull();
    expect(rows[0].password_reset_token).toBe(before[0].password_reset_token);

    // And a normal (non-production) run still reaches them.
    const ok = await request(app).post(sendUrl).set('Cookie', adminCookie).send({});
    expect(ok.body.sent).toBe(1);
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

// ── One customer: read, edit, invite (harvest 2 lane 3, ported from ice #336) ──

describe('one customer: GET/PATCH /:id and POST /:id/invite', () => {
  let custId;

  // A plain, passwordless customer (what "Add customer" makes).
  async function makeCustomer(email = 'solo@example.com') {
    const res = await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie)
      .send({ email, display_name: 'Solo Kúnni', send_invite: false });
    expect(res.status).toBe(201);
    return res.body.customer.id;
  }

  // A staff account holding one custom role with exactly these views.
  async function staffWith(views, name) {
    await db.query(`INSERT INTO roles (name, view_access) VALUES ($1, $2::jsonb) ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`,
      [name, JSON.stringify(views)]);
    const { rows } = await db.query(
      `INSERT INTO users (email, username, password_hash, role, approval_status, email_verified)
       VALUES ($1, $2, 'x', $3, 'approved', TRUE) RETURNING id`, [`${name}@staff.is`, `${name}_staff`, name]);
    return rows[0].id;
  }

  beforeEach(async () => { custId = await makeCustomer(); });
  afterEach(async () => { await db.query(`DELETE FROM roles WHERE name IN ('crm-seller', 'lead-seller')`).catch(() => {}); });

  test('create with send_invite:false mails nothing, returns no link, audits user.created', async () => {
    const res = await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie)
      .send({ email: 'later@example.com', send_invite: false });
    expect(res.status).toBe(201);
    expect(res.body.invited).toBe(false);
    expect(res.body).not.toHaveProperty('resetUrl');
    const { rows } = await db.query(
      `SELECT action FROM staff_audit_log WHERE entity_id = $1`, [res.body.customer.id]);
    expect(rows.map(r => r.action)).toEqual(['user.created']);
  });

  test('GET returns the editable fields; staff, party guests and unknown ids are 404', async () => {
    const res = await request(app).get(`/api/v1/admin/customers/${custId}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.customer).toMatchObject({ id: custId, email: 'solo@example.com', display_name: 'Solo Kúnni', has_password: false, address1: null });
    const modId = await createTestModeratorUser();
    const { rows: [a] } = await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    const guest = await createTestPendingGuest({ email: 'pg9@party.is', username: 'pg9' });
    for (const id of [modId, a.id, guest.id, 'no-such-id']) {
      expect((await request(app).get(`/api/v1/admin/customers/${id}`).set('Cookie', adminCookie)).status).toBe(404);
    }
  });

  test('PATCH edits contact + address: trims, lowercases the email, upper-cases the country, blank clears', async () => {
    await db.query(`UPDATE users SET email_verified = TRUE, invited_at = NOW() WHERE id = $1`, [custId]);
    const res = await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', adminCookie)
      .send({ email: '  New.Addr@Example.com ', display_name: ' Jón Jónsson ', phone: '+354 555 1234',
        address1: 'Laugavegur 1', address2: '', city: 'Reykjavík', zip: '101', country: 'is' });
    expect(res.status).toBe(200);
    expect(res.body.customer).toMatchObject({
      email: 'new.addr@example.com', display_name: 'Jón Jónsson', phone: '+354 555 1234',
      address1: 'Laugavegur 1', address2: null, city: 'Reykjavík', zip: '101', country: 'IS',
    });
    // A new address is unverified, any link sent to the old one is dead, and
    // invited_at (the seller area's proof of a real address) is gone.
    const { rows: [u] } = await db.query(
      'SELECT email_verified, password_reset_token, invited_at FROM users WHERE id = $1', [custId]);
    expect(u.email_verified).toBe(false);
    expect(u.password_reset_token).toBeNull();
    expect(u.invited_at).toBeNull();
    // Re-sending the SAME address changes nothing about it.
    await db.query(`UPDATE users SET email_verified = TRUE WHERE id = $1`, [custId]);
    await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', adminCookie).send({ email: 'new.addr@example.com' });
    const { rows: [same] } = await db.query('SELECT email_verified FROM users WHERE id = $1', [custId]);
    expect(same.email_verified).toBe(true);
    // Only the keys sent are touched.
    const again = await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', adminCookie)
      .send({ phone: '' });
    expect(again.body.customer).toMatchObject({ phone: null, city: 'Reykjavík', email: 'new.addr@example.com' });
  });

  test('user.updated names the fields changed, never their values', async () => {
    await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', adminCookie)
      .send({ display_name: 'Solo Kúnni', city: 'Akureyri' }); // the name is unchanged
    const { rows } = await db.query(
      `SELECT summary FROM staff_audit_log WHERE action = 'user.updated' AND entity_id = $1`, [custId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toEqual({ fields: ['city'] });
    expect(JSON.stringify(rows[0].summary)).not.toContain('Akureyri');
  });

  test('PATCH validation: bad email, blank email, bad phone, bad country, long address → 400', async () => {
    const bad = [
      { email: 'not-an-email' }, { email: '' }, { email: 'x@noemail.invalid' }, { phone: 'abc' },
      { country: 'Iceland' }, { address1: 'x'.repeat(201) }, { zip: 'x'.repeat(21) },
      // An Icelandic postnúmer is three digits (utils/contactFormat, as at checkout);
      // a blank country means Iceland.
      { zip: '1011', country: 'IS' }, { zip: 'AB1', country: '' },
    ];
    for (const body of bad) {
      const res = await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', adminCookie).send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(400);
    }
    // A foreign postcode is free text.
    expect((await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', adminCookie)
      .send({ zip: 'SW1A 1AA', country: 'GB' })).status).toBe(200);
  });

  test('PATCH to an email another login holds → 409, whatever the case', async () => {
    const res = await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', adminCookie)
      .send({ email: 'USER@test.com' }); // createTestRegularUser's address
    expect(res.status).toBe(409);
    // Its own address (re-sent) is not a conflict.
    expect((await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', adminCookie)
      .send({ email: 'Solo@Example.com' })).status).toBe(200);
  });

  test('PATCH never reaches a staff account or a multi-role holder (404)', async () => {
    const modId = await createTestModeratorUser();
    const sellerId = await staffWith(['leads'], 'lead-seller');
    const { rows: [multi] } = await db.query(
      `INSERT INTO users (email, username, password_hash, role) VALUES ('mr@example.com', 'mruser', NULL, 'user') RETURNING id`);
    await db.query(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'lead-seller')`, [multi.id]);
    for (const id of [modId, sellerId, multi.id]) {
      const res = await request(app).patch(`/api/v1/admin/customers/${id}`).set('Cookie', adminCookie)
        .send({ email: 'takeover@example.com' });
      expect(res.status).toBe(404);
    }
    const { rows } = await db.query(`SELECT 1 FROM users WHERE email = 'takeover@example.com'`);
    expect(rows).toHaveLength(0);
  });

  test('IDOR / role gate: a plain user and a staff role without `customers` get 403; a `customers` role may edit', async () => {
    const plain = await getTestSessionCookie(userId);
    const leadSeller = await getTestSessionCookie(await staffWith(['leads'], 'lead-seller'));
    for (const cookie of [plain, leadSeller]) {
      expect((await request(app).get(`/api/v1/admin/customers/${custId}`).set('Cookie', cookie)).status).toBe(403);
      expect((await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', cookie)
        .send({ display_name: 'Hijacked' })).status).toBe(403);
      expect((await request(app).post(`/api/v1/admin/customers/${custId}/invite`).set('Cookie', cookie)).status).toBe(403);
    }
    expect((await request(app).patch(`/api/v1/admin/customers/${custId}`)
      .send({ display_name: 'Anon' })).status).toBe(401);
    const { rows: [still] } = await db.query('SELECT display_name FROM users WHERE id = $1', [custId]);
    expect(still.display_name).toBe('Solo Kúnni');

    const crm = await getTestSessionCookie(await staffWith(['customers'], 'crm-seller'));
    const ok = await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', crm)
      .send({ display_name: 'Edited by CRM' });
    expect(ok.status).toBe(200);
    // …but the admin-only writes stay admin-only for that role.
    expect((await request(app).post('/api/v1/admin/customers').set('Cookie', crm)
      .send({ email: 'crm-made@example.com' })).status).toBe(403);
  });

  test('changing the EMAIL needs admin: a customers-view holder gets 403 and nothing changes', async () => {
    await db.query(
      `UPDATE users SET email_verified = TRUE, invited_at = NOW(), password_reset_token = 'tok-x' WHERE id = $1`, [custId]);
    const crm = await getTestSessionCookie(await staffWith(['customers'], 'crm-seller'));
    const res = await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', crm)
      .send({ email: 'crm-owned@example.com', phone: '+354 555 0000' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(403);
    expect(res.body.reason).toBe('email_admin_only');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).not.toBe('errors.admin.customerEmailAdminOnly'); // translated
    // Nothing at all was written — not even the phone that rode along.
    const { rows: [u] } = await db.query(
      `SELECT email, phone, email_verified, invited_at, password_reset_token FROM users WHERE id = $1`, [custId]);
    expect(u).toMatchObject({ email: 'solo@example.com', phone: null, email_verified: true, password_reset_token: 'tok-x' });
    expect(u.invited_at).not.toBeNull();
    const { rows: audit } = await db.query(
      `SELECT 1 FROM staff_audit_log WHERE action = 'user.updated' AND entity_id = $1`, [custId]);
    expect(audit).toHaveLength(0);

    // The same person may change the phone, and may re-send the SAME address.
    const phone = await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', crm)
      .send({ phone: '+354 555 0000', email: 'Solo@Example.com' });
    expect(phone.status).toBe(200);
    expect(phone.body.customer.phone).toBe('+354 555 0000');
  });

  test('an admin changing the email → 200, and invited_at, the token and verified are cleared', async () => {
    await db.query(
      `UPDATE users SET email_verified = TRUE, invited_at = NOW(), password_reset_token = 'tok-y',
              password_reset_expires = NOW() + interval '1 day' WHERE id = $1`, [custId]);
    const res = await request(app).patch(`/api/v1/admin/customers/${custId}`).set('Cookie', adminCookie)
      .send({ email: 'moved@example.com' });
    expect(res.status).toBe(200);
    const { rows: [u] } = await db.query(
      `SELECT email, email_verified, invited_at, password_reset_token, password_reset_expires FROM users WHERE id = $1`, [custId]);
    expect(u).toMatchObject({
      email: 'moved@example.com', email_verified: false, invited_at: null,
      password_reset_token: null, password_reset_expires: null,
    });
  });

  test('invite: mints a fresh token, reports honestly, NEVER returns the link; audited', async () => {
    const { rows: [before] } = await db.query('SELECT password_reset_token FROM users WHERE id = $1', [custId]);
    const res = await request(app).post(`/api/v1/admin/customers/${custId}/invite`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    // No mail transport in the test env: nothing reached the customer, and
    // still no set-password link comes back.
    expect(res.body.invited).toBe(false);
    expect(res.body).not.toHaveProperty('resetUrl');
    expect(JSON.stringify(res.body)).not.toMatch(/reset-password|token=/);
    const { rows: [after] } = await db.query(
      'SELECT password_reset_token, invited_at FROM users WHERE id = $1', [custId]);
    expect(after.password_reset_token).toBeTruthy();
    expect(after.password_reset_token).not.toBe(before.password_reset_token);
    expect(after.invited_at).toBeNull(); // stamped only on a confirmed send
    const { rows } = await db.query(
      `SELECT summary FROM staff_audit_log WHERE action = 'user.invited' AND entity_id = $1`, [custId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toMatchObject({ via: 'customer_invite', sent: false });
  });

  test('invite: a customer with a password is 409; a staff account 404', async () => {
    await db.query(`UPDATE users SET password_hash = 'x' WHERE id = $1`, [custId]);
    expect((await request(app).post(`/api/v1/admin/customers/${custId}/invite`).set('Cookie', adminCookie)).status).toBe(409);
    const modId = await createTestModeratorUser();
    expect((await request(app).post(`/api/v1/admin/customers/${modId}/invite`).set('Cookie', adminCookie)).status).toBe(404);
  });
});
