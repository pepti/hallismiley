// Service-contract invoices + the commission ledger (migration 098;
// ENHANCEMENTS #18, D-003/D-005): the company's own revenue path issues a
// real invoice (counter, lines, journal, books audit) to a customer account,
// and the commission hook writes one commission_events row per commissionable
// invoice in the same transaction with the owner + rate snapshotted. The
// report is scoped per seller and derives "payable" from the invoice being
// paid in full. CSRF is bypassed in test mode (see tests/env.js).
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Role    = require('../../server/models/Role');
const Setting = require('../../server/models/Setting');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const BOOKS = '/api/v1/admin/bookkeeping';
const ACCOUNTS = '/api/v1/admin/accounts';
const COMMISSION = '/api/v1/admin/commission';
const VALID_KENNITALA = '1203894599';
const A = 'test-seller-a', B = 'test-seller-b';

let adminCookie, sellerA, sellerB, userCookie, adminId, account;

async function ensureStaffRoles() {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES
       ('solumadur', 'Sölumaður', '["handbok", "leads", "accounts", "commission"]'::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`
  );
  Role.invalidateCache();
}

async function staffUser(id, username, fromUserId) {
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ($1, $2, $3, (SELECT password_hash FROM users WHERE id = $4), 'solumadur', TRUE)`,
    [id, `${username}@test.com`, username, fromUserId]
  );
  return getTestSessionCookie(id);
}

const issue = (body, cookie = adminCookie) =>
  request(app).post(`${BOOKS}/invoices/service`).set('Cookie', cookie).send(body);

beforeEach(async () => {
  await cleanTables();
  await ensureStaffRoles();
  adminId = await createTestAdminUser();
  const userId = await createTestRegularUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie  = await getTestSessionCookie(userId);
  sellerA = await staffUser(A, 'sellera', userId);
  sellerB = await staffUser(B, 'sellerb', userId);
  await Setting.updateBookkeepingSettings({
    seller_name: 'Orange Smiley ehf.', seller_kennitala: VALID_KENNITALA,
    seller_vat_number: '162561', payment_terms_days: 14,
  });
  const res = await request(app).post(ACCOUNTS).set('Cookie', adminCookie).send({
    name: 'Ísprjón ehf.', tier: 'verslun', kennitala: '9900000051', owner_user_id: A,
    build_fee_isk: 580000, monthly_fee_isk: 29000, quota_units: 10, contact_email: 'bud@isprjon.is',
  });
  account = res.body.account;
});

async function commissionRows(accountId) {
  const { rows } = await db.query(`SELECT * FROM commission_events WHERE account_id = $1 ORDER BY id`, [accountId]);
  return rows;
}

// ── Issuing ──────────────────────────────────────────────────────────────────

describe('POST /invoices/service', () => {
  test('build deposit: 50% of the fee ex VSK + 24% VSK, a real issued invoice, commission at 15% for the owner', async () => {
    const res = await issue({ account_id: account.id, kind: 'build', deposit: true });
    expect(res.status).toBe(201);
    const inv = res.body.invoice;
    expect(inv.status).toBe('issued');
    expect(Number(inv.subtotal_net)).toBe(290000);
    expect(Number(inv.vat_total)).toBe(69600);
    expect(Number(inv.total_gross)).toBe(359600);
    expect(inv.customer_kennitala).toBe('9900000051');
    expect(inv.customer_name).toBe('Ísprjón ehf.');
    expect(inv.order_id).toBeNull();

    expect(res.body.commission).toMatchObject({ kind: 'build', rate_bp: 1500, seller_user_id: A });
    expect(Number(res.body.commission.base_amount_isk)).toBe(290000);
    expect(Number(res.body.commission.amount_isk)).toBe(43500);

    const { rows: lines } = await db.query(`SELECT description, line_net, line_vat, revenue_account FROM invoice_lines WHERE invoice_id = $1`, [inv.id]);
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toMatch(/Uppsetning Rekstrarkerfisins — Verslun — innborgun 50%/);
    expect(lines[0].revenue_account).toBe('4110');

    const { rows: audit } = await db.query(`SELECT summary FROM books_audit_log WHERE action = 'invoice.issued' AND entity_id = $1`, [inv.id]);
    expect(audit[0].summary.account_id).toBe(account.id);
    expect(audit[0].summary.kind).toBe('build');
    const { rows: staff } = await db.query(`SELECT summary FROM staff_audit_log WHERE action = 'commission.recorded' AND entity_id = $1`, [String(account.id)]);
    expect(staff).toHaveLength(1);
    expect(staff[0].summary.amount_isk).toBe(43500);
  });

  test('build final is the other half; recurring uses the monthly fee or an override; overage carries no commission', async () => {
    const fin = await issue({ account_id: account.id, kind: 'build', deposit: false });
    expect(fin.status).toBe(201);
    expect(Number(fin.body.invoice.subtotal_net)).toBe(290000);

    const rec = await issue({ account_id: account.id, kind: 'recurring', period: '2026-09' });
    expect(rec.status).toBe(201);
    expect(Number(rec.body.invoice.subtotal_net)).toBe(29000);
    expect(rec.body.commission).toMatchObject({ kind: 'recurring', rate_bp: 1000 });
    expect(Number(rec.body.commission.amount_isk)).toBe(2900);
    expect(String(rec.body.commission.period)).toMatch(/^2026-/);
    const { rows: lines } = await db.query(`SELECT description FROM invoice_lines WHERE invoice_id = $1`, [rec.body.invoice.id]);
    expect(lines[0].description).toBe('Þjónustusamningur — Verslun — september 2026');

    const pro = await issue({ account_id: account.id, kind: 'recurring', period: '2026-10', amount_net_isk: 14500 });
    expect(Number(pro.body.invoice.subtotal_net)).toBe(14500);
    expect(Number(pro.body.commission.amount_isk)).toBe(1450);

    const over = await issue({ account_id: account.id, kind: 'overage', units: 3, unit_price_isk: 15000 });
    expect(over.status).toBe(201);
    expect(Number(over.body.invoice.subtotal_net)).toBe(45000);
    expect(over.body.commission).toBeNull();

    expect(await commissionRows(account.id)).toHaveLength(3);
  });

  test('access: seller 403, plain user 403, unauthenticated 401', async () => {
    const body = { account_id: account.id, kind: 'build' };
    expect((await issue(body, sellerA)).status).toBe(403);
    expect((await issue(body, userCookie)).status).toBe(403);
    expect((await request(app).post(`${BOOKS}/invoices/service`).send(body)).status).toBe(401);
  });

  test('errors: bad kind 400, recurring without period 400, bad overage 400, unknown account 404, no fees 409, seller incomplete 409', async () => {
    expect((await issue({ account_id: account.id, kind: 'gift' })).status).toBe(400);
    expect((await issue({ account_id: account.id, kind: 'recurring' })).status).toBe(400);
    expect((await issue({ account_id: account.id, kind: 'overage', units: 0, unit_price_isk: 10 })).status).toBe(400);
    expect((await issue({ account_id: 999999, kind: 'build' })).status).toBe(404);
    const bare = await request(app).post(ACCOUNTS).set('Cookie', adminCookie).send({ name: 'Engin gjöld', tier: 'vefur' });
    expect((await issue({ account_id: bare.body.account.id, kind: 'build' })).status).toBe(409);
    await Setting.updateBookkeepingSettings({ seller_kennitala: '', seller_vat_number: '' });
    expect((await issue({ account_id: account.id, kind: 'build' })).status).toBe(409);
    expect(await commissionRows(account.id)).toHaveLength(0);
  });
});

// ── Report ───────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/commission', () => {
  test('accrued on issue, payable once the invoice is paid in full; scoped per seller', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    const invoiceId = dep.body.invoice.id;

    let a = await request(app).get(COMMISSION).set('Cookie', sellerA);
    expect(a.status).toBe(200);
    expect(a.headers['cache-control']).toBe('no-store');
    expect(a.body.scope).toBe('own');
    expect(a.body.rows).toHaveLength(1);
    expect(Number(a.body.rows[0].accrued_isk)).toBe(43500);
    expect(Number(a.body.rows[0].payable_isk)).toBe(0);
    expect(a.body.events[0].invoice_paid).toBe(false);

    const pay = await request(app).post(`${BOOKS}/invoices/${invoiceId}/payments`).set('Cookie', adminCookie)
      .send({ amount: 359600, method: 'bank_transfer', idempotency_key: 'pay-1' });
    expect([200, 201]).toContain(pay.status);

    a = await request(app).get(COMMISSION).set('Cookie', sellerA);
    expect(Number(a.body.rows[0].payable_isk)).toBe(43500);
    expect(a.body.events[0].invoice_paid).toBe(true);

    const b = await request(app).get(COMMISSION).set('Cookie', sellerB);
    expect(b.body.rows).toEqual([]);
    const all = await request(app).get(COMMISSION).set('Cookie', adminCookie);
    expect(all.body.scope).toBe('all');
    expect(all.body.rows).toHaveLength(1);
    expect(all.body.rows[0].seller_username).toBe('sellera');

    expect((await request(app).get(COMMISSION).set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).get(COMMISSION)).status).toBe(401);

    const csv = await request(app).get(`${COMMISSION}/export.csv`).set('Cookie', sellerA);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('sellera');
    expect(csv.text).toContain('43500');
  });

  test('an owner change moves only future commission', async () => {
    await issue({ account_id: account.id, kind: 'build', deposit: true });
    expect((await request(app).patch(`${ACCOUNTS}/${account.id}/owner`).set('Cookie', adminCookie).send({ owner_user_id: B })).status).toBe(200);
    const rec = await issue({ account_id: account.id, kind: 'recurring', period: '2026-11' });
    expect(rec.body.commission.seller_user_id).toBe(B);

    const rows = await commissionRows(account.id);
    expect(rows.map(r => [r.kind, r.seller_user_id])).toEqual([['build', A], ['recurring', B]]);
    const a = await request(app).get(COMMISSION).set('Cookie', sellerA);
    expect(a.body.events.map(e => e.kind)).toEqual(['build']);
    const b = await request(app).get(COMMISSION).set('Cookie', sellerB);
    expect(b.body.events.map(e => e.kind)).toEqual(['recurring']);
    // The account's own commission tab follows the account scope: B owns it now.
    expect((await request(app).get(`${ACCOUNTS}/${account.id}/commission`).set('Cookie', sellerA)).status).toBe(404);
    const own = await request(app).get(`${ACCOUNTS}/${account.id}/commission`).set('Cookie', sellerB);
    expect(own.body.events).toHaveLength(2);
  });

  test('date range narrows the report', async () => {
    await issue({ account_id: account.id, kind: 'recurring', period: '2026-09', issued_at: '2026-09-01' });
    await issue({ account_id: account.id, kind: 'recurring', period: '2026-10', issued_at: '2026-10-01' });
    const sep = await request(app).get(`${COMMISSION}?from=2026-09-01&to=2026-09-30`).set('Cookie', adminCookie);
    expect(sep.body.rows).toHaveLength(1);
    expect(String(sep.body.rows[0].period)).toMatch(/^2026-09/);
  });
});

// ── Review fixes, 2026-09-07 ─────────────────────────────────────────────────
// Each test here pins one defect the three-reviewer pass on this chunk found.
// They are regression tests: every one of them fails on the code as merged.

describe('regressions', () => {
  test('a seller cannot set their own commission rate; an admin can', async () => {
    // The controller whitelist let build_rate_bp / recurring_rate_bp through
    // from ANY holder of the accounts view, so a seller could create an
    // account at 90% and invoice themselves the difference.
    const mine = await request(app).post(ACCOUNTS).set('Cookie', sellerA).send({
      name: 'Gráðugur ehf.', tier: 'vefur', build_fee_isk: 400000, monthly_fee_isk: 20000,
      build_rate_bp: 9000, recurring_rate_bp: 9000,
    });
    expect(mine.status).toBe(201);
    expect(Number(mine.body.account.build_rate_bp)).toBe(1500);
    expect(Number(mine.body.account.recurring_rate_bp)).toBe(1000);

    const bumped = await request(app).patch(`${ACCOUNTS}/${mine.body.account.id}`)
      .set('Cookie', sellerA).send({ build_rate_bp: 9000 });
    expect(bumped.status).toBe(200);
    expect(Number(bumped.body.account.build_rate_bp)).toBe(1500);

    const byAdmin = await request(app).patch(`${ACCOUNTS}/${mine.body.account.id}`)
      .set('Cookie', adminCookie).send({ build_rate_bp: 2000 });
    expect(Number(byAdmin.body.account.build_rate_bp)).toBe(2000);

    // And the rate the invoice snapshots is the stored one, not the sent one.
    const inv = await issue({ account_id: mine.body.account.id, kind: 'build', deposit: true });
    expect(Number(inv.body.commission.rate_bp)).toBe(2000);
  });

  test('the account commission tab needs the commission view, not just accounts', async () => {
    // `verktaki` holds accounts + allaccounts but NOT commission, and the tab
    // route was gated on the accounts view alone — every seller's earnings.
    await db.query(
      `INSERT INTO roles (name, description, view_access, is_system)
       VALUES ('verktaki', 'Verktaki', '["handbok", "accounts", "allaccounts"]'::jsonb, FALSE)
       ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`
    );
    Role.invalidateCache();
    const { rows: [seed] } = await db.query(`SELECT id FROM users WHERE username = 'sellera'`);
    await db.query(
      `INSERT INTO users (id, email, username, password_hash, role, email_verified)
       VALUES ($1, $2, $3, (SELECT password_hash FROM users WHERE id = $4), 'verktaki', TRUE)`,
      ['test-verktaki', 'verktaki1@test.com', 'verktaki1', seed.id]
    );
    const cookie = await getTestSessionCookie('test-verktaki');

    await issue({ account_id: account.id, kind: 'build', deposit: true });
    // The account itself is visible to them (allaccounts) …
    expect((await request(app).get(`${ACCOUNTS}/${account.id}`).set('Cookie', cookie)).status).toBe(200);
    // … but the money on it is not.
    expect((await request(app).get(`${ACCOUNTS}/${account.id}/commission`).set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).get(COMMISSION).set('Cookie', cookie)).status).toBe(403);
  });

  test('payable drops when the invoice is credited or refunded', async () => {
    // `payable` compared amount_paid against total_gross alone, so a fully
    // credited invoice still paid commission on money the company gave back.
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    const invoiceId = dep.body.invoice.id;
    await request(app).post(`${BOOKS}/invoices/${invoiceId}/payments`).set('Cookie', adminCookie)
      .send({ amount: 359600, method: 'bank_transfer', idempotency_key: 'pay-1' });

    let a = await request(app).get(COMMISSION).set('Cookie', sellerA);
    expect(Number(a.body.rows[0].payable_isk)).toBe(43500);

    const refund = await request(app).post(`${BOOKS}/invoices/${invoiceId}/refunds`).set('Cookie', adminCookie)
      .send({ amount: 359600, method: 'bank_transfer', reason: 'Hætt við', idempotency_key: 'ref-1' });
    expect([200, 201]).toContain(refund.status);

    a = await request(app).get(COMMISSION).set('Cookie', sellerA);
    expect(Number(a.body.rows[0].accrued_isk)).toBe(43500);   // still earned on paper
    expect(Number(a.body.rows[0].payable_isk)).toBe(0);        // but not payable
    expect(a.body.events[0].invoice_paid).toBe(false);
  });

  test('the same build half cannot be invoiced twice', async () => {
    // Two clicks on "Gefa út reikning" used to issue two statutory invoices,
    // and 505/2013 says an invoice can only be undone by a credit note.
    const first = await issue({ account_id: account.id, kind: 'build', deposit: true });
    expect(first.status).toBe(201);
    const second = await issue({ account_id: account.id, kind: 'build', deposit: true });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already has that build-fee instalment/);
    expect(await commissionRows(account.id)).toHaveLength(1);

    // The other half is a different document and still goes through.
    expect((await issue({ account_id: account.id, kind: 'build', deposit: false })).status).toBe(201);
  });

  test('the same recurring month cannot be invoiced twice, but the next month can', async () => {
    expect((await issue({ account_id: account.id, kind: 'recurring', period: '2026-10' })).status).toBe(201);
    const dup = await issue({ account_id: account.id, kind: 'recurring', period: '2026-10' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already has a service invoice for 2026-10/);
    expect((await issue({ account_id: account.id, kind: 'recurring', period: '2026-11' })).status).toBe(201);
  });

  test('overage is not deduplicated — it is metered, and a month can have several', async () => {
    expect((await issue({ account_id: account.id, kind: 'overage', units: 3, unit_price_isk: 12000 })).status).toBe(201);
    expect((await issue({ account_id: account.id, kind: 'overage', units: 2, unit_price_isk: 12000 })).status).toBe(201);
  });
});
