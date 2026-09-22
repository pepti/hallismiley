// The build deposit is a customer prepayment, not earned revenue (migration
// 101; Bókari's ruling 2026-09-08).
//
// The point of this file is the pair of clocks. Under lög nr. 3/2006 26. gr. a
// deposit invoiced before delivery is a LIABILITY until go-live; under lög nr.
// 50/1988 13. gr. its net is skattskyld velta and its 24% útskattur in the
// period the invoice is DATED. So the P&L must not move on the deposit and the
// VSK return must not move at all — and the second half is the one a naive fix
// breaks, by dropping box A while box D keeps the tax.
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Setting = require('../../server/models/Setting');
const vatService = require('../../server/services/bookkeeping/vatService');
const reportService = require('../../server/services/bookkeeping/reportService');
const { toIsoDate } = require('../../server/utils/booksDate');
const { createTestAdminUser, getTestSessionCookie, cleanTables } = require('../helpers');

const BOOKS = '/api/v1/admin/bookkeeping';
const ACCOUNTS = '/api/v1/admin/accounts';

let adminCookie, account;

// Debits positive, credits negative — the idiom booksInvoice.test.js uses.
async function legsOf(entryId) {
  const { rows } = await db.query(
    `SELECT la.code, jl.debit, jl.credit
       FROM journal_lines jl JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE jl.entry_id = $1`,
    [entryId]
  );
  const out = {};
  for (const r of rows) out[r.code] = (out[r.code] || 0) + Number(r.debit) - Number(r.credit);
  return out;
}

async function entryFor(sourceType, sourceId) {
  const { rows } = await db.query(
    `SELECT id FROM journal_entries WHERE source_type = $1 AND source_id = $2 ORDER BY id DESC LIMIT 1`,
    [sourceType, String(sourceId)]
  );
  return rows[0] ? rows[0].id : null;
}

async function balanceOf(code) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::bigint AS bal
       FROM journal_lines jl JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1`,
    [code]
  );
  return Number(rows[0].bal);
}

const issue = (body) =>
  request(app).post(`${BOOKS}/invoices/service`).set('Cookie', adminCookie).send(body);

beforeEach(async () => {
  await cleanTables();
  const adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  await Setting.updateBookkeepingSettings({
    seller_name: 'Orange Smiley ehf.', seller_kennitala: '1203894599',
    seller_vat_number: '162561', payment_terms_days: 14,
  });
  const res = await request(app).post(ACCOUNTS).set('Cookie', adminCookie).send({
    name: 'Ísprjón ehf.', tier: 'verslun', kennitala: '9900000051',
    contact_email: 'bud@isprjon.is',
    street: 'Bæjargata 5', postal_zone: '101', city: 'Reykjavík', country: 'IS',
    build_fee_isk: 580000, monthly_fee_isk: 29000,
  });
  expect(res.status).toBe(201);
  account = res.body.account;
});

describe('the deposit entry', () => {
  test('credits deferred income, not revenue, and leaves the document untouched', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    expect(dep.status).toBe(201);
    const inv = dep.body.invoice;

    // 1100 Viðskiptakröfur 359.600 / 2150 290.000 / 2200 útskattur 69.600.
    expect(await legsOf(await entryFor('invoice', inv.id))).toEqual({
      1100: 359600, 2150: -290000, 2200: -69600,
    });

    // Not one króna of revenue moved. This is the assertion that fails on the
    // code as merged.
    const { rows: rev } = await db.query(
      `SELECT COUNT(*)::int AS n FROM journal_lines jl
         JOIN ledger_accounts la ON la.id = jl.account_id
        WHERE jl.entry_id = $1 AND la.type = 'revenue'`,
      [await entryFor('invoice', inv.id)]
    );
    expect(rev[0].n).toBe(0);

    // The customer's document is byte-for-byte what it was: only the internal
    // account holding the net changed.
    expect(Number(inv.subtotal_net)).toBe(290000);
    expect(Number(inv.vat_total)).toBe(69600);
    expect(Number(inv.total_gross)).toBe(359600);
    const { rows: lines } = await db.query(
      `SELECT revenue_account, vat_rate FROM invoice_lines WHERE invoice_id = $1`, [inv.id]
    );
    expect(lines[0].revenue_account).toBe('2150');
    expect(Number(lines[0].vat_rate)).toBe(24);
  });

  test('the P&L shows nothing and the balance sheet shows the liability', async () => {
    await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    const pl = await reportService.profitAndLoss({ from: '2026-08-01', to: '2026-08-31' });
    expect(Number(pl.revenue_total)).toBe(0);
    expect(await balanceOf('2150')).toBe(290000);
  });
});

describe('the VSK return does not move', () => {
  // Every figure here is identical to what the revenue-on-issue treatment
  // produced; only the account holding the 290.000 changed.
  test('box A carries the deposit net and box D its 24%, in the deposit period', async () => {
    await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    const r = await vatService.deriveReturn(db, '2026-P4');
    expect(Number(r.box_a_net_24)).toBe(290000);
    expect(Number(r.box_d_output)).toBe(69600);
    expect(Number(r.box_b_net_11)).toBe(0);
    expect(Number(r.box_c_net_zero)).toBe(0);
    expect(Number(r.box_e_input)).toBe(0);
    expect(Number(r.box_f_payable)).toBe(69600);
  });

  test('output VAT is always 24% of box A plus 11% of box B', async () => {
    // The structural invariant. It fails the moment anyone books turnover
    // somewhere box A cannot see — including the naive version of this fix.
    await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    await issue({ account_id: account.id, kind: 'recurring', period: '2026-08', issued_at: '2026-08-30' });
    const r = await vatService.deriveReturn(db, '2026-P4');
    const expected = Math.round(Number(r.box_a_net_24) * 24 / 100)
                   + Math.round(Number(r.box_b_net_11) * 11 / 100);
    expect(Number(r.box_d_output)).toBe(expected);
  });

  test('a period with only a deposit is not a nil return', async () => {
    await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    const pre = await vatService.preflight(db, '2026-P4');
    expect((pre.blockers || []).map(b => b.code)).not.toContain('NIL_RETURN');
  });
});

describe('release at go-live', () => {
  test('the final half posts its own invoice AND releases the deposit', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    const fin = await issue({ account_id: account.id, kind: 'build', deposit: false, issued_at: '2026-09-01' });
    expect(fin.status).toBe(201);
    expect(fin.body.recognition.released).toBe(290000);

    expect(await legsOf(await entryFor('invoice', fin.body.invoice.id))).toEqual({
      1100: 359600, 4110: -290000, 2200: -69600,
    });
    // The release: deferred income out, revenue in. Nets to zero in box A.
    expect(await legsOf(await entryFor('revenue_recognition', dep.body.invoice.id))).toEqual({
      2150: 290000, 4110: -290000,
    });

    const { rows } = await db.query(
      `SELECT revenue_recognised_at, recognised_into_account, revenue_recognised_entry_id
         FROM invoices WHERE id = $1`, [dep.body.invoice.id]
    );
    expect(toIsoDate(rows[0].revenue_recognised_at)).toBe('2026-09-01');
    expect(rows[0].recognised_into_account).toBe('4110');
    expect(rows[0].revenue_recognised_entry_id).toBeTruthy();

    expect(await balanceOf('2150')).toBe(0);
    const pl = await reportService.profitAndLoss({ from: '2026-07-01', to: '2026-09-30' });
    expect(Number(pl.revenue_total)).toBe(580000);
  });

  test('across two VSK periods each carries its own half, and the total is the whole fee', async () => {
    await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-07-10' });
    await issue({ account_id: account.id, kind: 'build', deposit: false, issued_at: '2026-09-05' });
    // Two DISTINCT VSK periods: P4 = júlí–ágúst, P5 = september–október.
    const p4 = await vatService.deriveReturn(db, '2026-P4');
    const p5 = await vatService.deriveReturn(db, '2026-P5');
    expect(Number(p4.box_a_net_24)).toBe(290000);
    expect(Number(p5.box_a_net_24)).toBe(290000);
    expect(Number(p4.box_d_output)).toBe(69600);
    expect(Number(p5.box_d_output)).toBe(69600);
  });

  test('both halves in one period is 580.000 of turnover, counted once', async () => {
    await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    await issue({ account_id: account.id, kind: 'build', deposit: false, issued_at: '2026-08-20' });
    const r = await vatService.deriveReturn(db, '2026-P4');
    expect(Number(r.box_a_net_24)).toBe(580000);
    expect(Number(r.box_d_output)).toBe(139200);
  });

  test('a final half with no deposit issues cleanly and releases nothing', async () => {
    const fin = await issue({ account_id: account.id, kind: 'build', deposit: false, issued_at: '2026-09-05' });
    expect(fin.status).toBe(201);
    expect(fin.body.recognition).toBeNull();
    expect(await entryFor('revenue_recognition', fin.body.invoice.id)).toBeNull();
  });
});

describe('credit notes', () => {
  const credit = (id, gross, reason = 'Hætt við') =>
    request(app).post(`${BOOKS}/invoices/${id}/credit-notes`).set('Cookie', adminCookie)
      .send({ amount_gross: gross, reason });

  test('crediting an UNRELEASED deposit debits the liability back to zero', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    expect([200, 201]).toContain((await credit(dep.body.invoice.id, 359600)).status);
    expect(await balanceOf('2150')).toBe(0);
    // The turnover comes back out of box A in the period the CREDIT NOTE is
    // dated (13. gr. 5. mgr.), never retroactively out of the deposit's period —
    // a filed return is not restated. So the two periods net to zero.
    const p4 = await vatService.deriveReturn(db, '2026-P4');
    const p5 = await vatService.deriveReturn(db, '2026-P5');
    expect(Number(p4.box_a_net_24)).toBe(290000);
    expect(Number(p5.box_a_net_24)).toBe(-290000);
    expect(Number(p4.box_d_output) + Number(p5.box_d_output)).toBe(0);
  });

  test('crediting a RELEASED deposit debits revenue, never the liability', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    await issue({ account_id: account.id, kind: 'build', deposit: false, issued_at: '2026-09-01' });
    expect(await balanceOf('2150')).toBe(0);

    expect([200, 201]).toContain((await credit(dep.body.invoice.id, 359600)).status);

    // The whole reason recognised_into_account is snapshotted: without it this
    // would debit 2150 a second time and drive a liability negative.
    expect(await balanceOf('2150')).toBe(0);
    expect(await balanceOf('4110')).toBe(290000); // the final half's revenue survives
  });

  test('the liability can never go debit, however the halves are credited', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    const fin = await issue({ account_id: account.id, kind: 'build', deposit: false, issued_at: '2026-09-01' });
    expect(await balanceOf('2150')).toBeGreaterThanOrEqual(0);
    await credit(fin.body.invoice.id, 359600);
    expect(await balanceOf('2150')).toBeGreaterThanOrEqual(0);
    await credit(dep.body.invoice.id, 359600);
    expect(await balanceOf('2150')).toBe(0);
    // A full unwind: no revenue and no turnover left standing. Across periods,
    // because each document counts in the period it is dated — the deposit in
    // P4, the release and both credit notes in P5.
    const pl = await reportService.profitAndLoss({ from: '2026-07-01', to: '2026-09-30' });
    expect(Number(pl.revenue_total)).toBe(0);
    const p4 = await vatService.deriveReturn(db, '2026-P4');
    const p5 = await vatService.deriveReturn(db, '2026-P5');
    expect(Number(p4.box_a_net_24) + Number(p5.box_a_net_24)).toBe(0);
  });
});

describe('nothing else moves', () => {
  test('recurring and overage still credit revenue directly', async () => {
    const rec = await issue({ account_id: account.id, kind: 'recurring', period: '2026-08', issued_at: '2026-08-01' });
    const ovr = await issue({ account_id: account.id, kind: 'overage', units: 2, unit_price_isk: 12000, issued_at: '2026-08-05' });
    const recLegs = await legsOf(await entryFor('invoice', rec.body.invoice.id));
    const ovrLegs = await legsOf(await entryFor('invoice', ovr.body.invoice.id));
    // Delivered work is revenue on issue. Only an undelivered prepayment defers.
    expect(recLegs['4110']).toBeLessThan(0);
    expect(recLegs['2150']).toBeUndefined();
    expect(ovrLegs['4110']).toBeLessThan(0);
    expect(ovrLegs['2150']).toBeUndefined();
  });

  test('commission accrues on the invoice, not on the recognition', async () => {
    const dep = await issue({ account_id: account.id, kind: 'build', deposit: true, issued_at: '2026-08-03' });
    expect(Number(dep.body.commission.base_amount_isk)).toBe(290000);
    expect(Number(dep.body.commission.rate_bp)).toBe(1500);
    expect(Number(dep.body.commission.amount_isk)).toBe(43500);
    await issue({ account_id: account.id, kind: 'build', deposit: false, issued_at: '2026-09-01' });
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM commission_events WHERE account_id = $1`, [account.id]);
    expect(rows[0].n).toBe(2); // one per invoice; the release is not a commissionable event
  });
});
