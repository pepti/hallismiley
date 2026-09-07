// Integration tests for customer accounts (migration 098; ENHANCEMENTS #17):
// row scoping in both layers (a seller's foreign id answers 404; admin and the
// `allaccounts` permission see everything), the lifecycle transition map, the
// admin-only owner change, the #16 hand-off (create from a market row moves it
// to handed_to_sales in one transaction), the staff audit rows every write
// leaves, the immutable audit trigger, and the body whitelist. CSRF is
// bypassed in test mode (see tests/env.js).
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Role    = require('../../server/models/Role');
const { importMarketData } = require('../../server/scripts/market-import');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const BASE = '/api/v1/admin/accounts';

// Mirror of the 098 role seed (adminRoles.test.js clears non-system roles).
async function ensureStaffRoles() {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES
       ('solumadur', 'Sölumaður', '["handbok", "leads", "accounts", "commission"]'::jsonb, FALSE),
       ('verktaki',  'Verktaki',  '["handbok", "accounts", "allaccounts"]'::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`
  );
  Role.invalidateCache();
}

async function staffUser(id, username, role, fromUserId) {
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ($1, $2, $3, (SELECT password_hash FROM users WHERE id = $4), $5, TRUE)`,
    [id, `${username}@test.com`, username, fromUserId, role]
  );
  return getTestSessionCookie(id);
}

async function auditRows(entityId) {
  const { rows } = await db.query(
    `SELECT action, summary, actor_id FROM staff_audit_log WHERE entity_type = 'account' AND entity_id = $1 ORDER BY id`,
    [String(entityId)]
  );
  return rows;
}

let adminCookie, sellerA, sellerB, verktaki, userCookie, adminId;
const A = 'test-seller-a', B = 'test-seller-b', V = 'test-verktaki';

beforeEach(async () => {
  await cleanTables();
  await db.query(`DELETE FROM market_companies WHERE kennitala LIKE '99%'`);
  await ensureStaffRoles();
  adminId = await createTestAdminUser();
  const userId = await createTestRegularUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie  = await getTestSessionCookie(userId);
  sellerA  = await staffUser(A, 'sellera', 'solumadur', userId);
  sellerB  = await staffUser(B, 'sellerb', 'solumadur', userId);
  verktaki = await staffUser(V, 'verktaki1', 'verktaki', userId);
});

afterAll(async () => { await db.query(`DELETE FROM market_companies WHERE kennitala LIKE '99%'`); });

const create = (cookie, body) => request(app).post(BASE).set('Cookie', cookie).send(body);

// ── Access ───────────────────────────────────────────────────────────────────

describe('access', () => {
  test('unauthenticated 401, plain user 403, seller 200 + no-store', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).get(BASE).set('Cookie', userCookie)).status).toBe(403);
    const res = await request(app).get(BASE).set('Cookie', sellerA);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.scope).toBe('own');
    expect(res.body.accounts).toEqual([]);
  });
});

// ── Create + scoping ─────────────────────────────────────────────────────────

describe('create + row scope', () => {
  test('a seller creates and owns; the other seller cannot see it; verktaki and admin can', async () => {
    const res = await create(sellerA, { name: 'Ísprjón ehf.', tier: 'verslun', kennitala: '9900000021', contact_email: 'buð@isprjon.is' });
    expect(res.status).toBe(201);
    const acc = res.body.account;
    expect(acc.owner_user_id).toBe(A);
    expect(acc.slug).toBe('isprjon-ehf');
    expect(acc.status).toBe('lead');
    expect(Number(acc.build_rate_bp)).toBe(1500);
    expect(Number(acc.recurring_rate_bp)).toBe(1000);

    const mine = await request(app).get(BASE).set('Cookie', sellerA);
    expect(mine.body.accounts.map(a => a.id)).toEqual([acc.id]);
    const theirs = await request(app).get(BASE).set('Cookie', sellerB);
    expect(theirs.body.accounts).toEqual([]);
    expect((await request(app).get(`${BASE}/${acc.id}`).set('Cookie', sellerB)).status).toBe(404);
    expect((await request(app).patch(`${BASE}/${acc.id}`).set('Cookie', sellerB).send({ name: 'x' })).status).toBe(404);

    const v = await request(app).get(BASE).set('Cookie', verktaki);
    expect(v.body.scope).toBe('all');
    expect(v.body.accounts.map(a => a.id)).toEqual([acc.id]);
    expect((await request(app).get(`${BASE}/${acc.id}`).set('Cookie', adminCookie)).status).toBe(200);

    const audit = await auditRows(acc.id);
    expect(audit.map(r => r.action)).toEqual(['account.created']);
    expect(audit[0].actor_id).toBe(A);
  });

  test('a seller cannot assign another owner; admin can', async () => {
    const asSeller = await create(sellerA, { name: 'Alfa', tier: 'vefur', owner_user_id: B });
    expect(asSeller.body.account.owner_user_id).toBe(A);
    const asAdmin = await create(adminCookie, { name: 'Beta', tier: 'vefur', owner_user_id: B });
    expect(asAdmin.body.account.owner_user_id).toBe(B);
    expect((await create(adminCookie, { name: 'Gamma', tier: 'vefur', owner_user_id: 'no-such-user' })).status).toBe(400);
  });

  test('validation: name/tier required, bad tier, bad kennitala, bad slug, duplicate slug is suffixed, duplicate kennitala 409', async () => {
    expect((await create(sellerA, { tier: 'vefur' })).status).toBe(400);
    expect((await create(sellerA, { name: 'X', tier: 'gold' })).status).toBe(400);
    expect((await create(sellerA, { name: 'X', tier: 'vefur', kennitala: '123' })).status).toBe(400);
    expect((await create(sellerA, { name: 'X', tier: 'vefur', slug: 'Bad Slug' })).status).toBe(400);
    const one = await create(sellerA, { name: 'Sama nafn', tier: 'vefur', kennitala: '9900000031' });
    const two = await create(sellerA, { name: 'Sama nafn', tier: 'vefur' });
    expect(two.status).toBe(201);
    expect(two.body.account.slug).toBe(`${one.body.account.slug}-2`);
    expect((await create(sellerA, { name: 'Annað', tier: 'vefur', kennitala: '9900000031' })).status).toBe(409);
  });

  test('hand-off from a market row copies the facts and moves the row to handed_to_sales', async () => {
    await importMarketData({ companies: [{
      kennitala: '9900000041', name: 'Markaðsbúð ehf.', sector_group: 'smasala', list_type: 'smb',
      fit_score: 85, tier_fit: 'rekstur', status: 'shortlist', financials: [],
    }], stats: [] });
    const { rows: [mc] } = await db.query(`SELECT id FROM market_companies WHERE kennitala = '9900000041'`);

    const res = await create(sellerA, { market_company_id: mc.id });
    expect(res.status).toBe(201);
    expect(res.body.account.name).toBe('Markaðsbúð ehf.');
    expect(res.body.account.kennitala).toBe('9900000041');
    expect(res.body.account.tier).toBe('rekstur');
    expect(res.body.account.market_company_id).toBe(mc.id);
    const { rows: [after] } = await db.query(`SELECT status FROM market_companies WHERE id = $1`, [mc.id]);
    expect(after.status).toBe('handed_to_sales');

    // Unknown market row → 404, nothing created.
    expect((await create(sellerA, { market_company_id: 999999 })).status).toBe(404);
  });

  // Regression (2026-09-07 review): the hand-off read the market row without
  // checking its status, so creating an account was a back door around
  // PATCH /markadur/:id/status — which is admin/moderator-only and only fires
  // FROM shortlist. A seller could hand themselves any candidate in the list,
  // and hand the SAME shortlisted row to themselves twice.
  test('hand-off refuses a row that is not shortlisted, and refuses a second hand-off', async () => {
    await importMarketData({ companies: [
      { kennitala: '9900000042', name: 'Frumkandídat ehf.', sector_group: 'smasala', list_type: 'smb', status: 'candidate', financials: [] },
      { kennitala: '9900000043', name: 'Hafnað ehf.', sector_group: 'smasala', list_type: 'smb', status: 'rejected', financials: [] },
      { kennitala: '9900000044', name: 'Tvígefið ehf.', sector_group: 'smasala', list_type: 'smb', status: 'shortlist', financials: [] },
    ], stats: [] });
    const idOf = async (kt) => (await db.query(`SELECT id FROM market_companies WHERE kennitala = $1`, [kt])).rows[0].id;

    // A 404, not a 403: the row is not one this seller may act on, and saying
    // "forbidden" would confirm it exists.
    expect((await create(sellerA, { market_company_id: await idOf('9900000042') })).status).toBe(404);
    expect((await create(sellerA, { market_company_id: await idOf('9900000043') })).status).toBe(404);

    // The shortlisted one works once …
    const twice = await idOf('9900000044');
    expect((await create(sellerA, { market_company_id: twice })).status).toBe(201);
    // … and the row is handed_to_sales now, so a second attempt is refused
    // rather than creating a duplicate account for the same company.
    expect((await create(sellerB, { market_company_id: twice })).status).toBe(404);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM customer_accounts WHERE market_company_id = $1`, [twice]);
    expect(rows[0].n).toBe(1);
  });
});

// ── Lifecycle ────────────────────────────────────────────────────────────────

describe('lifecycle', () => {
  test('transitions follow the map; a skip is 409; every move is audited', async () => {
    const { body: { account } } = await create(sellerA, { name: 'Ferill', tier: 'vefur' });
    const patch = (body, cookie = sellerA) => request(app).patch(`${BASE}/${account.id}`).set('Cookie', cookie).send(body);

    expect((await patch({ status: 'live' })).status).toBe(409);
    let r = await patch({ status: 'offered' });
    expect(r.status).toBe(200);
    expect(r.body.account.status).toBe('offered');
    expect(r.body.transitions).toEqual(['signed', 'lead', 'churned']);
    r = await patch({ status: 'signed' });
    expect(r.body.account.status).toBe('signed');

    // Provision request: signed → provisioning + its own audit row.
    const p = await request(app).post(`${BASE}/${account.id}/provision-request`).set('Cookie', sellerA);
    expect(p.status).toBe(202);
    expect(p.body.account.status).toBe('provisioning');

    expect((await patch({ status: 'building' })).body.account.status).toBe('building');
    expect((await patch({ status: 'live' })).body.account.status).toBe('live');
    expect((await patch({ status: 'churned' })).body.account.status).toBe('churned');
    expect((await patch({ status: 'live' })).status).toBe(409);

    const actions = (await auditRows(account.id)).map(r => r.action);
    expect(actions).toEqual([
      'account.created',
      'account.status_changed', 'account.status_changed',
      'account.status_changed', 'provision.requested',
      'account.status_changed', 'account.status_changed', 'account.status_changed',
    ]);
  });

  test('patch: fields update, unknown fields are ignored, bad email 400, empty body 400', async () => {
    const { body: { account } } = await create(sellerA, { name: 'Breyta', tier: 'vefur' });
    const patch = (body) => request(app).patch(`${BASE}/${account.id}`).set('Cookie', sellerA).send(body);
    const r = await patch({ monthly_fee_isk: 19000, build_fee_isk: 390000, quota_units: 5, contract_start: '2026-10-01', owner_user_id: B, evil: 'x' });
    expect(r.status).toBe(200);
    expect(Number(r.body.account.monthly_fee_isk)).toBe(19000);
    expect(String(r.body.account.contract_start)).toMatch(/^2026-10-01/);
    expect(r.body.account.owner_user_id).toBe(A);           // not an editable field
    expect((await patch({ contact_email: 'nope' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    const audit = await auditRows(account.id);
    expect(audit[1].action).toBe('account.updated');
    expect(audit[1].summary.fields).toEqual(expect.arrayContaining(['monthly_fee_isk', 'build_fee_isk']));
  });
});

// ── Owner change (admin only) ────────────────────────────────────────────────

describe('owner change', () => {
  test('seller 403, admin 200 + audit, unknown owner 400, unknown account 404', async () => {
    const { body: { account } } = await create(sellerA, { name: 'Eigandi', tier: 'vefur' });
    expect((await request(app).patch(`${BASE}/${account.id}/owner`).set('Cookie', sellerA).send({ owner_user_id: B })).status).toBe(403);
    const r = await request(app).patch(`${BASE}/${account.id}/owner`).set('Cookie', adminCookie).send({ owner_user_id: B });
    expect(r.status).toBe(200);
    expect(r.body.account.owner_user_id).toBe(B);
    // Now B owns it and A no longer sees it.
    expect((await request(app).get(`${BASE}/${account.id}`).set('Cookie', sellerB)).status).toBe(200);
    expect((await request(app).get(`${BASE}/${account.id}`).set('Cookie', sellerA)).status).toBe(404);
    const audit = await auditRows(account.id);
    expect(audit.at(-1).action).toBe('account.owner_changed');
    expect(audit.at(-1).summary).toEqual({ from: A, to: B });
    expect((await request(app).patch(`${BASE}/${account.id}/owner`).set('Cookie', adminCookie).send({ owner_user_id: 'ghost' })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/999999/owner`).set('Cookie', adminCookie).send({ owner_user_id: B })).status).toBe(404);
  });
});

// ── Audit trail ──────────────────────────────────────────────────────────────

describe('audit', () => {
  test('the account trail is scoped; staff_audit_log rows cannot be altered or deleted', async () => {
    const { body: { account } } = await create(sellerA, { name: 'Slóð', tier: 'vefur' });
    const mine = await request(app).get(`${BASE}/${account.id}/audit`).set('Cookie', sellerA);
    expect(mine.status).toBe(200);
    expect(mine.body.entries[0].action).toBe('account.created');
    expect(mine.body.entries[0].actor_username).toBe('sellera');
    expect((await request(app).get(`${BASE}/${account.id}/audit`).set('Cookie', sellerB)).status).toBe(404);

    await expect(db.query(`UPDATE staff_audit_log SET action = 'x' WHERE entity_id = $1`, [String(account.id)]))
      .rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM staff_audit_log WHERE entity_id = $1`, [String(account.id)]))
      .rejects.toThrow(/append-only/);
  });

  test('GET /api/v1/admin/audit is admin-only, newest first, filterable', async () => {
    await create(sellerA, { name: 'Fyrsti', tier: 'vefur' });
    await create(sellerB, { name: 'Annar', tier: 'vefur' });
    expect((await request(app).get('/api/v1/admin/audit').set('Cookie', sellerA)).status).toBe(403);
    const res = await request(app).get('/api/v1/admin/audit?action=account.created').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.total).toBe(2);
    expect(res.body.entries.map(e => e.actor_username)).toEqual(['sellerb', 'sellera']);
    expect(res.body.actions).toContain('role.granted');
  });
});
