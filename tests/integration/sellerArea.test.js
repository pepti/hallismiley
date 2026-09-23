// Seller area (D-020): ops builds a snapshot → signs it → the PUBLIC instance
// ingests it → each seller reads their own part, read-only, behind 2FA.
//
// One test DB plays both instances: the snapshot is built from the ops tables
// (leads, customer_accounts, commission_*) and applied to the published_*
// tables, with INSTANCE_ROLE flipped per test. What must hold:
//   • nothing reaches the public box that ops did not grant (views), and never
//     the commission rates or the payee kennitala;
//   • only a correctly signed, fresh, newer snapshot is applied;
//   • a seller sees their own accounts and statements and nobody else's, only
//     from a proven email, only with 2FA on;
//   • on ops both routes do not exist.
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Role = require('../../server/models/Role');
const { buildSnapshot } = require('../../server/services/sellerPublish/snapshot');
const signature = require('../../server/services/sellerPublish/signature');
const { createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables } = require('../helpers');

const SECRET = 'x'.repeat(40);
const INGEST = '/api/v1/seller-publish';
const API = '/api/v1/seller';

let adminId, adminCookie, regularId;

async function ensureRoles() {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES
       ('solumadur', 'Sölumaður', '["handbok", "leads", "accounts", "commission"]'::jsonb, FALSE),
       ('solufolk',  'Sölufólk',  '["handbok", "leads"]'::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`
  );
  Role.invalidateCache();
}

async function user(id, email, role, { verified = true, invited = false } = {}) {
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified, invited_at)
     VALUES ($1, $2, $3, (SELECT password_hash FROM users WHERE id = $4), $5, $6, $7)`,
    [id, email, id.replace(/[^a-z0-9]/g, ''), regularId, role, verified, invited ? new Date() : null]
  );
  return id;
}

const post = (body, { secret = SECRET, t } = {}) => {
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return request(app).post(INGEST)
    .set('Content-Type', 'application/json')
    .set(signature.HEADER, signature.sign(secret, raw, t))
    .send(raw.toString('utf8'));
};

async function publish() {
  const snap = await buildSnapshot(db.pool);
  const res = await post(snap);
  expect(res.status).toBe(201);
  return snap;
}

function asPublic() {
  process.env.INSTANCE_ROLE = 'public';
  process.env.SELLER_PUBLISH_SECRET = SECRET;
}

beforeEach(async () => {
  delete process.env.INSTANCE_ROLE;
  delete process.env.SELLER_PUBLISH_SECRET;
  await cleanTables();
  await db.query('TRUNCATE published_statement_lines, published_payouts, published_statements, published_accounts, published_leads, published_sellers, seller_publications, leads');
  await ensureRoles();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  regularId = await createTestRegularUser();

  // Ops side: two sellers, a trainee, and a disabled seller.
  await user('seller-a', 'Anna@Test.com', 'solumadur');
  await user('seller-b', 'bjorn@test.com', 'solumadur');
  await user('trainee', 'trainee@test.com', 'solufolk');
  await user('gone', 'gone@test.com', 'solumadur');
  await db.query('UPDATE users SET disabled = TRUE WHERE id = $1', ['gone']);

  await db.query(
    `INSERT INTO leads (submission_id, name, email, company, message, status, owner_user_id)
     VALUES (gen_random_uuid(), 'Jón Jónsson', 'jon@kaffi.is', 'Kaffi ehf.', 'Vantar vefverslun', 'contacted', 'seller-a'),
            (gen_random_uuid(), 'Gunna', 'gunna@example.is', NULL, 'Hringið í mig', 'new', NULL)`
  );
  await db.query(
    `INSERT INTO customer_accounts (slug, name, tier, status, owner_user_id, monthly_fee_isk, build_rate_bp, recurring_rate_bp)
     VALUES ('kaffi-ehf', 'Kaffi ehf.', 'verslun', 'live', 'seller-a', 29000, 1500, 1000),
            ('bjorn-co',  'Björn & co', 'vefur',   'signed', 'seller-b', 19000, 1500, 1000)`
  );
  // A statement for seller A through the real settlement path.
  const adj = await request(app).post('/api/v1/admin/commission/adjustments').set('Cookie', adminCookie)
    .send({ seller_user_id: 'seller-a', kind: 'manual_credit', amount_isk: 30000, reason: 'Upphafsstaða', effective_on: '2026-08-10' });
  expect(adj.status).toBe(201);
  const st = await request(app).post('/api/v1/admin/commission/statements').set('Cookie', adminCookie)
    .send({ seller_user_id: 'seller-a', period: '2026-08' });
  expect(st.status).toBe(201);
});

afterAll(() => {
  delete process.env.INSTANCE_ROLE;
  delete process.env.SELLER_PUBLISH_SECRET;
});

// Skipped as a whole on a product that hides, disables or forks the feature
// this suite belongs to, or when the feature is another product's
// (features/local.json — see tests/lib/featureGate.js). Shadows the global.
const { describeForSpec } = require('../lib/featureGate');
const describe = describeForSpec(__filename);

describe('Snapshot (ops)', () => {
  test('publishes sellers by their views; never admins, disabled users, rates or kennitala', async () => {
    const snap = await buildSnapshot(db.pool);
    const emails = snap.sellers.map(s => s.email);
    expect(emails).toEqual(['anna@test.com', 'bjorn@test.com', 'trainee@test.com']);
    const trainee = snap.sellers.find(s => s.email === 'trainee@test.com');
    expect(trainee).toMatchObject({ can_leads: true, can_accounts: false, can_commission: false });

    expect(snap.leads).toHaveLength(2);
    expect(snap.leads.find(l => l.name === 'Jón Jónsson').owner_email).toBe('anna@test.com');
    expect(snap.accounts.map(a => a.seller_email).sort()).toEqual(['anna@test.com', 'bjorn@test.com']);
    const body = JSON.stringify(snap);
    expect(body).not.toMatch(/rate_bp|kennitala|azure|repo_name/);
    expect(snap.statements).toHaveLength(1);
    expect(snap.statements[0]).toMatchObject({ seller_email: 'anna@test.com', period: '2026-08-01' });
  });

  test('no seller holds `leads` → no enquirer PII in the snapshot', async () => {
    await db.query(`UPDATE roles SET view_access = '["handbok", "accounts", "commission"]'::jsonb WHERE name = 'solumadur'`);
    await db.query(`UPDATE roles SET view_access = '["handbok"]'::jsonb WHERE name = 'solufolk'`);
    Role.invalidateCache();
    const snap = await buildSnapshot(db.pool);
    expect(snap.leads).toEqual([]);
  });
});

describe('Ingest (public)', () => {
  test('is 404 on ops and on a public box with no secret', async () => {
    const snap = await buildSnapshot(db.pool);
    expect((await post(snap)).status).toBe(404);
    process.env.INSTANCE_ROLE = 'public';
    expect((await post(snap)).status).toBe(404);
  });

  test('applies a signed snapshot and replaces the previous one whole', async () => {
    asPublic();
    await publish();
    let { rows } = await db.query('SELECT count(*)::int AS n FROM published_leads');
    expect(rows[0].n).toBe(2);

    // Erasure on ops reaches the public copy at the next publish.
    await db.query(`DELETE FROM leads WHERE name = 'Gunna'`);
    await publish();
    ({ rows } = await db.query('SELECT name FROM published_leads'));
    expect(rows.map(r => r.name)).toEqual(['Jón Jónsson']);
    ({ rows } = await db.query('SELECT count(*)::int AS n FROM seller_publications'));
    expect(rows[0].n).toBe(2);
  });

  test('refuses a bad signature, a wrong secret, and a stale timestamp — all 401', async () => {
    asPublic();
    const snap = await buildSnapshot(db.pool);
    expect((await post(snap, { secret: 'y'.repeat(40) })).status).toBe(401);
    expect((await post(snap, { t: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    const unsigned = await request(app).post(INGEST).set('Content-Type', 'application/json').send(snap);
    expect(unsigned.status).toBe(401);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM published_sellers');
    expect(rows[0].n).toBe(0);
  });

  test('refuses a replay and an older snapshot — 409, nothing rolled back', async () => {
    asPublic();
    const newer = await buildSnapshot(db.pool, { now: new Date('2026-09-21T12:00:00Z') });
    const older = await buildSnapshot(db.pool, { now: new Date('2026-09-20T12:00:00Z') });
    expect((await post(newer)).status).toBe(201);
    expect((await post(newer)).status).toBe(409);
    expect((await post(older)).status).toBe(409);
  });

  test('refuses a malformed body with 400 and writes nothing', async () => {
    asPublic();
    const snap = await buildSnapshot(db.pool);
    const cases = [
      '{not json',
      { ...snap, version: 2 },
      { ...snap, snapshot_id: 'nope' },
      { ...snap, sellers: [{ ...snap.sellers[0], can_leads: 'yes' }] },
      { ...snap, accounts: [{ ...snap.accounts[0], seller_email: 'stranger@test.com' }] },
      { ...snap, leads: [{ ...snap.leads[0], status: 'hacked' }] },
      { ...snap, leads: [null] },
    ];
    for (const body of cases) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    const { rows } = await db.query('SELECT count(*)::int AS n FROM seller_publications');
    expect(rows[0].n).toBe(0);
  });
});

describe('Seller API (public)', () => {
  let annaCookie;

  async function publicAccount(id, email, opts) {
    await user(id, email, 'user', opts);
    return getTestSessionCookie(id);
  }
  const enrol = (id) => db.query('UPDATE users SET totp_enabled = TRUE WHERE id = $1', [id]);

  beforeEach(async () => {
    asPublic();
    await publish();
    // On the public box the seller is an ordinary account with a matching email.
    // (One DB here, so the public account needs its own id and the ops seller's
    // email must be free — move the ops user aside first.)
    await db.query(`UPDATE users SET email = 'ops-anna@test.com' WHERE id = 'seller-a'`);
    annaCookie = await publicAccount('pub-anna', 'anna@test.com');
  });

  test('is 404 on ops', async () => {
    process.env.INSTANCE_ROLE = 'ops';
    expect((await request(app).get(`${API}/me`).set('Cookie', annaCookie)).status).toBe(404);
  });

  test('401 without a session; 404 for a non-seller and for an unproven email', async () => {
    expect((await request(app).get(`${API}/me`)).status).toBe(401);
    const other = await getTestSessionCookie(regularId);
    expect((await request(app).get(`${API}/me`).set('Cookie', other)).status).toBe(404);

    await db.query(`UPDATE users SET email = 'ops-bjorn@test.com' WHERE id = 'seller-b'`);
    const squatter = await publicAccount('pub-bjorn', 'bjorn@test.com', { verified: false });
    expect((await request(app).get(`${API}/me`).set('Cookie', squatter)).status).toBe(404);
    // …an admin invite proves the mailbox as well.
    await db.query('UPDATE users SET invited_at = NOW() WHERE id = $1', ['pub-bjorn']);
    expect((await request(app).get(`${API}/me`).set('Cookie', squatter)).status).toBe(200);
  });

  // Rule 4 in routes/sellerRoutes.js is the seller area's own gate and does
  // not follow security.mfa.enrolment: this runs under the instance default,
  // `optional` (mfa-optional-2026-09-23), and a seller still needs 2FA.
  test('/me works before 2FA; everything else needs it — even with enrolment optional', async () => {
    expect(require('../../server/auth/mfaPolicy').enrolmentMode()).toBe('optional');
    const me = await request(app).get(`${API}/me`).set('Cookie', annaCookie);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ mfa_ready: false, seller: { email: 'anna@test.com', can_leads: true } });
    expect(me.headers['cache-control']).toBe('no-store');
    const leads = await request(app).get(`${API}/leads`).set('Cookie', annaCookie);
    expect(leads.status).toBe(403);
  });

  test('with 2FA: all leads, OWN accounts and statements only', async () => {
    await enrol('pub-anna');
    const leads = await request(app).get(`${API}/leads`).set('Cookie', annaCookie);
    expect(leads.status).toBe(200);
    expect(leads.body.leads).toHaveLength(2);

    const accounts = await request(app).get(`${API}/accounts`).set('Cookie', annaCookie);
    expect(accounts.body.accounts.map(a => a.name)).toEqual(['Kaffi ehf.']);
    expect(accounts.body.accounts[0]).not.toHaveProperty('build_rate_bp');

    const list = await request(app).get(`${API}/statements`).set('Cookie', annaCookie);
    expect(list.body.statements).toHaveLength(1);
    const s = list.body.statements[0];
    expect(s.period).toBe('2026-08-01');
    const detail = await request(app).get(`${API}/statements/${s.ops_id}`).set('Cookie', annaCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.statement.closing_balance_isk)
      .toBe(s.payable_isk + s.carried_isk);
    expect(detail.body.lines.length).toBeGreaterThan(0);
    expect(detail.body.statement).not.toHaveProperty('payee_kennitala');
  });

  test('a seller cannot read another seller\'s statement (404) or a section ops did not grant (403)', async () => {
    await db.query(`UPDATE users SET email = 'ops-bjorn@test.com' WHERE id = 'seller-b'`);
    const bjorn = await publicAccount('pub-bjorn', 'bjorn@test.com');
    await enrol('pub-bjorn');
    const { rows: [s] } = await db.query('SELECT ops_id FROM published_statements');
    expect((await request(app).get(`${API}/statements/${s.ops_id}`).set('Cookie', bjorn)).status).toBe(404);

    await db.query(`UPDATE users SET email = 'ops-trainee@test.com' WHERE id = 'trainee'`);
    const trainee = await publicAccount('pub-trainee', 'trainee@test.com');
    await enrol('pub-trainee');
    expect((await request(app).get(`${API}/leads`).set('Cookie', trainee)).status).toBe(200);
    expect((await request(app).get(`${API}/accounts`).set('Cookie', trainee)).status).toBe(403);
    expect((await request(app).get(`${API}/statements`).set('Cookie', trainee)).status).toBe(403);
  });

  test('the session says seller:true, and a published seller may enrol in 2FA', async () => {
    const session = await request(app).get('/auth/session').set('Cookie', annaCookie);
    expect(session.body.user.seller).toBe(true);

    const csrfRes = await request(app).get('/api/v1/csrf-token').set('Cookie', annaCookie);
    const cookie = [annaCookie, ...(csrfRes.headers['set-cookie'] || []).map(c => c.split(';')[0])].join('; ');
    const setup = await request(app).post('/auth/totp/setup').set('Cookie', cookie)
      .set('x-csrf-token', csrfRes.body.csrfToken || csrfRes.body.token).send({});
    expect(setup.status).toBe(200);
  });

  test('login challenges an enrolled published seller for the second factor', async () => {
    await enrol('pub-anna');
    const res = await request(app).post('/auth/login')
      .send({ username: 'pubanna', password: process.env.ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('on ops the session flag is false', async () => {
    process.env.INSTANCE_ROLE = 'ops';
    const session = await request(app).get('/auth/session').set('Cookie', annaCookie);
    expect(session.body.user.seller).toBe(false);
  });
});
