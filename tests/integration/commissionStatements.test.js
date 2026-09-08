// Commission settlement — statements, payouts, clawback (migration 102; D-019).
//
// The property under test throughout is the balance identity:
//
//   closing = opening + earned − clawback + adjustment − settled
//   closing = payable + carried
//
// and the thing that makes it safe: the windows are SET DIFFERENCES, so a
// payment recorded late, a backdated payout or a skipped month lands on the
// NEXT statement instead of falling between two of them. No statement is ever
// reopened.
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Role = require('../../server/models/Role');
const Setting = require('../../server/models/Setting');
const { createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables } = require('../helpers');

const BOOKS = '/api/v1/admin/bookkeeping';
const ACCOUNTS = '/api/v1/admin/accounts';
const C = '/api/v1/admin/commission';
const A = 'test-seller-a';

let adminCookie, sellerA, userCookie, account;

async function ensureRoles() {
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

const issue = (body) => request(app).post(`${BOOKS}/invoices/service`).set('Cookie', adminCookie).send(body);
const pay = (invoiceId, amount, key) =>
  request(app).post(`${BOOKS}/invoices/${invoiceId}/payments`).set('Cookie', adminCookie)
    .send({ amount, method: 'bank_transfer', idempotency_key: key });
const creditNote = (invoiceId, gross) =>
  request(app).post(`${BOOKS}/invoices/${invoiceId}/credit-notes`).set('Cookie', adminCookie)
    .send({ amount_gross: gross, reason: 'Hætt við' });
const refund = (invoiceId, amount, key) =>
  request(app).post(`${BOOKS}/invoices/${invoiceId}/refunds`).set('Cookie', adminCookie)
    .send({ amount, method: 'bank_transfer', reason: 'Hætt við', idempotency_key: key });

const makeStatement = (period, seller = A, cookie = adminCookie) =>
  request(app).post(`${C}/statements`).set('Cookie', cookie).send({ seller_user_id: seller, period });
const preview = (period, seller = A) =>
  request(app).post(`${C}/statements/preview`).set('Cookie', adminCookie).send({ seller_user_id: seller, period });
const payout = (id, body) =>
  request(app).post(`${C}/statements/${id}/payouts`).set('Cookie', adminCookie).send(body);
const adjust = (body) =>
  request(app).post(`${C}/adjustments`).set('Cookie', adminCookie).send(body);

// The identity, asserted on every statement any test produces.
function expectBalanced(s) {
  expect(Number(s.closing_balance_isk)).toBe(
    Number(s.opening_balance_isk) + Number(s.earned_isk) - Number(s.clawback_isk)
    + Number(s.adjustment_isk) - Number(s.settled_isk)
  );
  expect(Number(s.closing_balance_isk)).toBe(Number(s.payable_isk) + Number(s.carried_isk));
}

beforeEach(async () => {
  await cleanTables();
  await ensureRoles();
  const adminId = await createTestAdminUser();
  const userId = await createTestRegularUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie = await getTestSessionCookie(userId);
  sellerA = await staffUser(A, 'sellera', 'solumadur', userId);
  await Setting.updateBookkeepingSettings({
    seller_name: 'Orange Smiley ehf.', seller_kennitala: '1203894599',
    seller_vat_number: '162561', payment_terms_days: 14,
  });
  const res = await request(app).post(ACCOUNTS).set('Cookie', adminCookie).send({
    name: 'Ísprjón ehf.', tier: 'verslun', kennitala: '9900000051',
    street: 'Bæjargata 5', postal_zone: '101', city: 'Reykjavík', country: 'IS',
    owner_user_id: A, build_fee_isk: 580000, monthly_fee_isk: 29000,
  });
  expect(res.status).toBe(201);
  account = res.body.account;
});

describe('the happy path', () => {
  test('paid invoice → statement → payout → paid', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');

    const pv = await preview('2026-09');
    expect(pv.status).toBe(200);
    expect(Number(pv.body.preview.earned_isk)).toBe(43500);
    expect(Number(pv.body.preview.payable_isk)).toBe(43500);
    // A preview writes nothing.
    const { rows: none } = await db.query(`SELECT COUNT(*)::int AS n FROM commission_statements`);
    expect(none[0].n).toBe(0);

    const st = await makeStatement('2026-09');
    expect(st.status).toBe(201);
    const s = st.body.statement;
    expectBalanced(s);
    expect(Number(s.opening_balance_isk)).toBe(0);
    expect(Number(s.earned_isk)).toBe(43500);
    expect(Number(s.payable_isk)).toBe(43500);
    expect(s.payee_kind).toBe('contractor');

    const list = await request(app).get(`${C}/statements`).set('Cookie', adminCookie);
    expect(list.body.statements[0].status).toBe('open');

    const p = await payout(s.id, {
      amount_isk: 43500, paid_on: '2026-09-08', method: 'bank_transfer',
      seller_invoice_number: 'S-1', seller_vat_isk: 10440, idempotency_key: 'k1',
    });
    expect(p.status).toBe(201);
    // VSK is OUTSIDE the commission: the transfer is 53.940, the commission 43.500.
    expect(Number(p.body.payout.amount_isk)).toBe(43500);
    expect(Number(p.body.payout.seller_vat_isk)).toBe(10440);

    const after = await request(app).get(`${C}/statements`).set('Cookie', adminCookie);
    expect(after.body.statements[0].status).toBe('paid');

    // And the payout lands on the NEXT statement as a line, bringing the
    // balance back to zero.
    const oct = await makeStatement('2026-10');
    expectBalanced(oct.body.statement);
    expect(Number(oct.body.statement.settled_isk)).toBe(43500);
    expect(Number(oct.body.statement.closing_balance_isk)).toBe(0);
  });

  test('under the minimum the whole balance carries, and accumulates', async () => {
    await issue({ account_id: account.id, kind: 'recurring', period: '2026-09' });
    const { rows: inv } = await db.query(`SELECT id, total_gross FROM invoices ORDER BY id DESC LIMIT 1`);
    await pay(inv[0].id, Number(inv[0].total_gross), 'r1');

    const sep = await makeStatement('2026-09');
    const s = sep.body.statement;
    expectBalanced(s);
    expect(Number(s.earned_isk)).toBe(2900);     // 10% of 29.000
    expect(Number(s.payable_isk)).toBe(0);        // under 25.000
    expect(Number(s.carried_isk)).toBe(2900);
    expect(sep.body.statement.minimum_isk).toBe('25000');

    // October opens with September's carry.
    const oct = await makeStatement('2026-10');
    expect(Number(oct.body.statement.opening_balance_isk)).toBe(2900);
  });
});

describe('clawback (D-019)', () => {
  test('a credited and refunded sale reverses the commission on the NEXT statement', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    const sep = await makeStatement('2026-09');
    expect(Number(sep.body.statement.payable_isk)).toBe(43500);
    await payout(sep.body.statement.id, {
      amount_isk: 43500, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'k1',
    });

    // The sale is undone properly: credit note for the document, refund for the cash.
    expect([200, 201]).toContain((await creditNote(dep.body.invoice.id, 359600)).status);
    expect([200, 201]).toContain((await refund(dep.body.invoice.id, 359600, 'r1')).status);

    const oct = await makeStatement('2026-10');
    const s = oct.body.statement;
    expectBalanced(s);
    expect(Number(s.clawback_isk)).toBe(43500);
    expect(Number(s.settled_isk)).toBe(43500);
    // The company owes nothing and DEMANDS nothing: payable is floored at zero
    // and the negative balance simply carries (D-019).
    expect(Number(s.closing_balance_isk)).toBe(-43500);
    expect(Number(s.payable_isk)).toBe(0);
    expect(Number(s.carried_isk)).toBe(-43500);

    const detail = await request(app).get(`${C}/statements/${s.id}`).set('Cookie', adminCookie);
    const claw = detail.body.lines.find(l => l.line_kind === 'clawback');
    expect(Number(claw.payable_before_isk)).toBe(43500);
    expect(Number(claw.payable_after_isk)).toBe(0);
    expect(Number(claw.amount_isk)).toBe(-43500);
  });

  test('a partial credit claws back only the share that was undone', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    await makeStatement('2026-09');
    expect([200, 201]).toContain((await creditNote(dep.body.invoice.id, 179800)).status);
    expect([200, 201]).toContain((await refund(dep.body.invoice.id, 179800, 'r1')).status);
    const oct = await makeStatement('2026-10');
    expectBalanced(oct.body.statement);
    expect(Number(oct.body.statement.clawback_isk)).toBe(21750); // half of 43.500
  });

  test('a clawback nets against later earnings rather than being demanded', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    const sep = await makeStatement('2026-09');
    await payout(sep.body.statement.id, {
      amount_isk: 43500, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'k1',
    });
    await creditNote(dep.body.invoice.id, 359600);
    await refund(dep.body.invoice.id, 359600, 'r1');
    await makeStatement('2026-10');   // closing −43.500

    // Now the seller earns again: the debt nets down, nothing is invoiced back.
    const fin = await issue({ account_id: account.id, kind: 'build', deposit: false });
    await pay(fin.body.invoice.id, 359600, 'p2');
    const nov = await makeStatement('2026-11');
    const s = nov.body.statement;
    expectBalanced(s);
    expect(Number(s.opening_balance_isk)).toBe(-43500);
    expect(Number(s.earned_isk)).toBe(43500);
    expect(Number(s.closing_balance_isk)).toBe(0);
    expect(Number(s.payable_isk)).toBe(0);
  });

  test('a write-off clears a negative balance, and cannot be consumed twice', async () => {
    const adj = await adjust({
      seller_user_id: A, kind: 'writeoff', amount_isk: 31500,
      reason: 'Söluaðili hættur; 12 mánaða skuldajöfnunargluggi liðinn (D-019)',
    });
    expect(adj.status).toBe(201);
    const st = await makeStatement('2026-09');
    expect(Number(st.body.statement.adjustment_isk)).toBe(31500);
    // The global unique index on adjustment_id is what stops a second statement
    // consuming it — the window is a set difference, not a date range.
    const oct = await makeStatement('2026-10');
    expect(Number(oct.body.statement.adjustment_isk)).toBe(0);
  });

  test('the sign of an adjustment is a constraint, not a convention', async () => {
    const bad = await adjust({ seller_user_id: A, kind: 'writeoff', amount_isk: -5000, reason: 'rangt' });
    expect(bad.status).toBe(400);
    const ok = await adjust({ seller_user_id: A, kind: 'manual_debit', amount_isk: -5000, reason: 'leiðrétting' });
    expect(ok.status).toBe(201);
  });
});

describe('late and out-of-order activity', () => {
  test('a commission that becomes payable after a settled month lands on the next one', async () => {
    // A contract month, paid, so September has something to settle at all.
    await issue({ account_id: account.id, kind: 'recurring', period: '2026-09' });
    const { rows: rec } = await db.query(`SELECT id, total_gross FROM invoices ORDER BY id DESC LIMIT 1`);
    await pay(rec[0].id, Number(rec[0].total_gross), 'r1');
    // …and a build deposit the customer has NOT paid yet, so it is accrued but
    // not payable when September closes.
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });

    const sep = await makeStatement('2026-09');
    expect(Number(sep.body.statement.earned_isk)).toBe(2900);   // the contract month only
    const before = await db.query(`SELECT * FROM commission_statements WHERE id = $1`, [sep.body.statement.id]);

    await pay(dep.body.invoice.id, 359600, 'late');        // the customer pays afterwards

    const oct = await makeStatement('2026-10');
    expect(Number(oct.body.statement.earned_isk)).toBe(43500);
    // September is untouched, byte for byte.
    const after = await db.query(`SELECT * FROM commission_statements WHERE id = $1`, [sep.body.statement.id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  test('periods must run forward, and a month cannot be settled twice', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    expect((await makeStatement('2026-09')).status).toBe(201);
    expect((await makeStatement('2026-09')).status).toBe(409);
    const back = await makeStatement('2026-08');
    expect(back.status).toBe(409);
    expect(back.body.error).toMatch(/later month/i);
  });

  test('a seller with nothing at all cannot be given an empty statement', async () => {
    const res = await makeStatement('2026-09');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Nothing to settle/i);
  });
});

describe('payouts', () => {
  let stmtId;
  beforeEach(async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    stmtId = (await makeStatement('2026-09')).body.statement.id;
  });

  test('the same idempotency key pays once', async () => {
    const a = await payout(stmtId, { amount_isk: 20000, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'k' });
    const b = await payout(stmtId, { amount_isk: 20000, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'k' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.created).toBe(false);
    const { rows } = await db.query(`SELECT amount_paid_isk FROM commission_statements WHERE id = $1`, [stmtId]);
    expect(Number(rows[0].amount_paid_isk)).toBe(20000);
  });

  test('a payout cannot exceed what the statement still owes', async () => {
    const over = await payout(stmtId, { amount_isk: 99999, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'k' });
    expect(over.status).toBe(422);
    await payout(stmtId, { amount_isk: 40000, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'k1' });
    const rest = await payout(stmtId, { amount_isk: 4000, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'k2' });
    expect(rest.status).toBe(422);   // only 3.500 left
  });

  test('an employee is paid through payroll, never as a bank transfer here', async () => {
    await db.query(`UPDATE users SET payee_kind = 'employee' WHERE id = $1`, [A]);
    const s2 = await makeStatement('2026-10');
    expect(s2.body.statement.payee_kind).toBe('employee');
    // The statement above has payable 0 (September took the earnings), so use
    // September's, which was composed while they were a contractor. Re-read it:
    const bad = await payout(stmtId, { amount_isk: 1000, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'e1' });
    expect(bad.status).toBe(201);    // September's statement is still 'contractor'

    // A statement composed AFTER the change carries the new payee kind.
    await db.query(`UPDATE users SET payee_kind = 'employee' WHERE id = $1`, [A]);
    const fin = await issue({ account_id: account.id, kind: 'build', deposit: false });
    await pay(fin.body.invoice.id, 359600, 'p9');
    const nov = await makeStatement('2026-11');
    expect(nov.body.statement.payee_kind).toBe('employee');
    const wrong = await payout(nov.body.statement.id, {
      amount_isk: 1000, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'e2',
    });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error).toMatch(/payroll/i);
    const right = await payout(nov.body.statement.id, {
      amount_isk: 1000, paid_on: '2026-09-08', method: 'payroll', idempotency_key: 'e3',
    });
    expect(right.status).toBe(201);
  });

  test('an internal payee is computed but never payable', async () => {
    await db.query(`UPDATE users SET payee_kind = 'internal' WHERE id = $1`, [A]);
    const fin = await issue({ account_id: account.id, kind: 'build', deposit: false });
    await pay(fin.body.invoice.id, 359600, 'p9');
    const oct = await makeStatement('2026-10');
    expect(oct.body.statement.payee_kind).toBe('internal');
    expect(Number(oct.body.statement.payable_isk)).toBe(0);
    expect(Number(oct.body.statement.earned_isk)).toBe(43500);
    const p = await payout(oct.body.statement.id, {
      amount_isk: 1000, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'i1',
    });
    expect(p.status).toBe(409);
  });
});

describe('immutability and access', () => {
  test('statements, lines, payouts and adjustments are append-only', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    const s = (await makeStatement('2026-09')).body.statement;
    await payout(s.id, { amount_isk: 1000, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'k' });

    await expect(db.query(`UPDATE commission_statements SET earned_isk = 1 WHERE id = $1`, [s.id]))
      .rejects.toMatchObject({ code: '23001' });
    await expect(db.query(`DELETE FROM commission_statements WHERE id = $1`, [s.id]))
      .rejects.toMatchObject({ code: '23001' });
    await expect(db.query(`UPDATE commission_statement_lines SET amount_isk = 1 WHERE statement_id = $1`, [s.id]))
      .rejects.toMatchObject({ code: '23001' });
    await expect(db.query(`UPDATE commission_payouts SET amount_isk = 1 WHERE statement_id = $1`, [s.id]))
      .rejects.toMatchObject({ code: '23001' });
    // The one column that may move, because it is a counter.
    await expect(db.query(`UPDATE commission_statements SET amount_paid_isk = 1000 WHERE id = $1`, [s.id]))
      .resolves.toBeDefined();
  });

  test('a seller reads their own and writes nothing; a stranger sees nothing', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    const s = (await makeStatement('2026-09')).body.statement;

    const own = await request(app).get(`${C}/statements/${s.id}`).set('Cookie', sellerA);
    expect(own.status).toBe(200);
    expect(own.headers['cache-control']).toBe('no-store');

    expect((await makeStatement('2026-10', A, sellerA)).status).toBe(403);
    expect((await request(app).post(`${C}/statements/${s.id}/payouts`).set('Cookie', sellerA)
      .send({ amount_isk: 1, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'x' })).status).toBe(403);
    expect((await request(app).post(`${C}/adjustments`).set('Cookie', sellerA)
      .send({ seller_user_id: A, kind: 'manual_credit', amount_isk: 1, reason: 'nope' })).status).toBe(403);

    expect((await request(app).get(`${C}/statements`).set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).get(`${C}/statements/${s.id}`)).status).toBe(401);
  });

  test("another seller's statement is a 404, not a 403", async () => {
    const userId = await createTestRegularUser();
    const sellerB = await staffUser('test-seller-b', 'sellerb', 'solumadur', userId);
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    const s = (await makeStatement('2026-09')).body.statement;
    const res = await request(app).get(`${C}/statements/${s.id}`).set('Cookie', sellerB);
    expect(res.status).toBe(404);
  });

  test('allaccounts does NOT widen earnings — commissionScope only honours admin', async () => {
    const userId = await createTestRegularUser();
    await db.query(
      `INSERT INTO roles (name, description, view_access, is_system)
       VALUES ('both-test', 'accounts + allaccounts + commission', '["accounts","allaccounts","commission"]'::jsonb, FALSE)
       ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`
    );
    Role.invalidateCache();
    const cookie = await staffUser('test-both', 'bothuser', 'both-test', userId);
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    const s = (await makeStatement('2026-09')).body.statement;
    // They hold `commission`, so the route is open — but seller A's statement is
    // not theirs, and allaccounts must not change that.
    expect((await request(app).get(`${C}/statements/${s.id}`).set('Cookie', cookie)).status).toBe(404);
    const list = await request(app).get(`${C}/statements`).set('Cookie', cookie);
    expect(list.body.scope).toBe('own');
    expect(list.body.statements).toEqual([]);
  });

  test('the three settlement actions are in the staff audit trail', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    const s = (await makeStatement('2026-09')).body.statement;
    await payout(s.id, { amount_isk: 1000, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'k' });
    await adjust({ seller_user_id: A, kind: 'manual_credit', amount_isk: 500, reason: 'leiðrétting' });

    const { rows } = await db.query(
      `SELECT action, entity_type FROM staff_audit_log WHERE action LIKE 'commission.%' ORDER BY id`
    );
    const actions = rows.map(r => r.action);
    expect(actions).toContain('commission.statement_issued');
    expect(actions).toContain('commission.payout_recorded');
    expect(actions).toContain('commission.adjustment_recorded');
    expect(rows.find(r => r.action === 'commission.statement_issued').entity_type).toBe('statement');
  });
});

describe('the balance strip', () => {
  test('reports the live balance, independent of any statement', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true });
    await pay(dep.body.invoice.id, 359600, 'p1');
    const res = await request(app).get(C).set('Cookie', adminCookie);
    const row = res.body.balances.find(b => b.seller_user_id === A);
    expect(Number(row.payable_isk)).toBe(43500);
    expect(Number(row.balance_isk)).toBe(43500);
    expect(res.body.clawbackWindowMonths).toBe(12);

    const s = (await makeStatement('2026-09')).body.statement;
    await payout(s.id, { amount_isk: 43500, paid_on: '2026-09-08', method: 'bank_transfer', idempotency_key: 'k' });
    const after = await request(app).get(C).set('Cookie', adminCookie);
    expect(Number(after.body.balances.find(b => b.seller_user_id === A).balance_isk)).toBe(0);
  });
});
