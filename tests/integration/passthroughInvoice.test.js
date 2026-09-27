// The pass-through service invoice (D-022; migration 122): hosting beyond the
// tier's pattern at cost + markup, AI above the monthly allowance at cost +
// markup, billed as kind `passthrough` with NO seller commission. The one way to
// bill it before this — a `recurring` invoice with amount_net_isk overridden —
// paid the seller 10 % of it, about 77 % of the markup.
//
// Pinned here, on real Postgres: the amounts (allowance, per-line markup,
// rounding, VSK on top), no commission_events row and no effect on a statement,
// a balanced journal entry, the one-per-account-per-period guard (and the full-
// credit escape hatch), validation, RBAC, the terms handed to the admin preview,
// and migration 122 being safe to run twice. CSRF is bypassed in test mode.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Role    = require('../../server/models/Role');
const Setting = require('../../server/models/Setting');
const { migrations } = require('../../server/config/schema');
const { todayIso } = require('../../server/utils/booksDate');
const { passthroughTerms } = require('../../server/services/bookkeeping/invoiceService');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const BOOKS = '/api/v1/admin/bookkeeping';
const ACCOUNTS = '/api/v1/admin/accounts';
const C = '/api/v1/admin/commission';
const A = 'test-seller-a';

// Engine tests read the seam (CLAUDE.md, D-021): the terms are the product's
// `billing.passthrough`, so the expected figures are derived from them. The
// worked examples that pin D-022's own arithmetic (15 %, 2.000 kr.) run only
// in the engine, whose config holds exactly those values.
const T = passthroughTerms();
const mk = (cost) => Math.round(cost * (10000 + T.markupBp) / 10000);
const ENGINE = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../engine.json'), 'utf8')).role === 'engine';
const engineOnly = ENGINE ? describe : describe.skip;

let adminCookie, sellerA, userCookie, account;

async function staffUser(id, username, fromUserId) {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system) VALUES
       ('solumadur', 'Sölumaður', '["handbok", "leads", "accounts", "commission"]'::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`
  );
  Role.invalidateCache();
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ($1, $2, $3, (SELECT password_hash FROM users WHERE id = $4), 'solumadur', TRUE)`,
    [id, `${username}@test.com`, username, fromUserId]
  );
  return getTestSessionCookie(id);
}

const issue = (body, cookie = adminCookie) =>
  request(app).post(`${BOOKS}/invoices/service`).set('Cookie', cookie).send(body);
const pt = (lines, period = '2026-09', extra = {}) =>
  issue({ account_id: account.id, kind: 'passthrough', period, lines, ...extra });
const pay = (invoiceId, amount, key) =>
  request(app).post(`${BOOKS}/invoices/${invoiceId}/payments`).set('Cookie', adminCookie)
    .send({ amount, method: 'bank_transfer', idempotency_key: key, received_at: todayIso() });
const credit = (invoiceId, gross) =>
  request(app).post(`${BOOKS}/invoices/${invoiceId}/credit-notes`).set('Cookie', adminCookie)
    .send({ amount_gross: gross, reason: 'Leiðrétting á Azure-reikningi' });

async function linesOf(invoiceId) {
  const { rows } = await db.query(
    `SELECT description, quantity, unit_price_gross, line_net, line_vat, line_gross, revenue_account
       FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`, [invoiceId]
  );
  return rows.map(r => ({
    ...r,
    line_net: Number(r.line_net), line_vat: Number(r.line_vat), line_gross: Number(r.line_gross),
    unit_price_gross: Number(r.unit_price_gross),
  }));
}

async function commissionCount() {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM commission_events WHERE account_id = $1`, [account.id]);
  return rows[0].n;
}

beforeEach(async () => {
  await cleanTables();
  const adminId = await createTestAdminUser();
  const userId = await createTestRegularUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie = await getTestSessionCookie(userId);
  sellerA = await staffUser(A, 'sellera', userId);
  await Setting.updateBookkeepingSettings({
    seller_name: 'Orange Smiley ehf.', seller_kennitala: '1203894599',
    seller_vat_number: '162561', payment_terms_days: 14,
    seller_address: 'Arnarhraun 4\n220 Hafnarfjörður',
    seller_street: 'Arnarhraun 4', seller_city: 'Hafnarfjörður',
    seller_postal_zone: '220', seller_country: 'IS',
  });
  // An account WITH an owner and a recurring rate, so a commission row would
  // be written if the pass-through kind were (wrongly) commissionable.
  const res = await request(app).post(ACCOUNTS).set('Cookie', adminCookie).send({
    name: 'Ísprjón ehf.', tier: 'rekstur', kennitala: '9900000051', owner_user_id: A,
    street: 'Bæjargata 5', postal_zone: '101', city: 'Reykjavík', country: 'IS',
    build_fee_isk: 690000, monthly_fee_isk: 89000, contact_email: 'bud@isprjon.is',
  });
  expect(res.status).toBe(201);
  account = res.body.account;
});

afterAll(async () => { await db.pool.end(); });

// ── Amounts ──────────────────────────────────────────────────────────────────

engineOnly('amounts (D-022 worked examples)', () => {
  test('hosting at cost + 15 %, AI above the 2.000 kr. allowance at cost + 15 %, 24 % VSK on top', async () => {
    const res = await pt([
      { type: 'hosting', description: 'TEST-umhverfi allan mánuðinn', cost_isk: 10000 },
      { type: 'ai', description: 'Pantanalestur', cost_isk: 3500 },
    ]);
    expect(res.status).toBe(201);
    const inv = res.body.invoice;
    // hosting 10.000 × 1,15 = 11.500; AI (3.500 − 2.000) × 1,15 = 1.725
    expect(Number(inv.subtotal_net)).toBe(13225);
    expect(Number(inv.vat_total)).toBe(3174);      // round(13.225 × 0,24) = round(3.174)
    expect(Number(inv.total_gross)).toBe(16399);
    expect(inv.service_kind).toBe('passthrough');
    expect(String(inv.service_period).slice(0, 7)).toBe('2026-09');
    expect(res.body.commission).toBeNull();

    const lines = await linesOf(inv.id);
    expect(lines).toHaveLength(2);
    expect(lines.map(l => l.line_net)).toEqual([11500, 1725]);
    expect(lines[0].description).toBe(
      'Hýsing umfram staðlað umhverfi — TEST-umhverfi allan mánuðinn — september 2026 (kostnaður 10.000 kr. + 15 %)'
    );
    expect(lines[1].description).toBe(
      'Gervigreind umfram innifalið — Pantanalestur — september 2026 (kostnaður 3.500 kr., þar af 2.000 kr. innifalið + 15 %)'
    );
    // The lines add up to the invoice, VSK included, to the króna.
    expect(lines.reduce((s, l) => s + l.line_vat, 0)).toBe(3174);
    expect(lines.reduce((s, l) => s + l.line_gross, 0)).toBe(16399);
    for (const l of lines) {
      expect(l.revenue_account).toBe('4110');
      expect(Number(l.quantity)).toBe(1);
      expect(l.unit_price_gross).toBe(l.line_gross);
    }
  });

  test('the markup is rounded per line with Math.round, like the other kinds', async () => {
    const res = await pt([
      { type: 'hosting', description: 'Stærri gagnagrunnur', cost_isk: 1234 }, // 1.419,1 → 1.419
      { type: 'hosting', description: 'Aukaprófanir', cost_isk: 10 },           // 11,5 → 12
      { type: 'hosting', description: 'Log Analytics', cost_isk: 7 },           // 8,05 → 8
    ]);
    expect(res.status).toBe(201);
    const lines = await linesOf(res.body.invoice.id);
    expect(lines.map(l => l.line_net)).toEqual([1419, 12, 8]);
    expect(Number(res.body.invoice.subtotal_net)).toBe(1439);
    expect(Number(res.body.invoice.vat_total)).toBe(345);   // round(345,36)
    expect(lines.reduce((s, l) => s + l.line_vat, 0)).toBe(345);
  });

  test('the allowance comes off the AI lines in order, never below zero; a covered line stays at 0 kr.', async () => {
    const res = await pt([
      { type: 'ai', description: 'Pantanalestur', cost_isk: 1500 },     // all included
      { type: 'hosting', description: 'TEST-umhverfi', cost_isk: 4000 }, // 4.600
      { type: 'ai', description: 'Vörulýsingar', cost_isk: 1200 },       // 500 included → 700 × 1,15 = 805
    ]);
    expect(res.status).toBe(201);
    const lines = await linesOf(res.body.invoice.id);
    expect(lines.map(l => l.line_net)).toEqual([0, 4600, 805]);
    expect(lines[0].description).toMatch(/kostnaður 1\.500 kr\., þar af 1\.500 kr\. innifalið \+ 15 %\)$/);
    expect(lines[1].description).toMatch(/kostnaður 4\.000 kr\. \+ 15 %\)$/);
    expect(lines[2].description).toMatch(/kostnaður 1\.200 kr\., þar af 500 kr\. innifalið \+ 15 %\)$/);
    expect(lines[0].line_vat).toBe(0);

    const { rows: [a] } = await db.query(
      `SELECT summary FROM books_audit_log WHERE action = 'invoice.issued' AND entity_id = $1`, [res.body.invoice.id]
    );
    expect(a.summary).toMatchObject({
      kind: 'passthrough', period: '2026-09', markup_bp: 1500, ai_cost_isk: 2700, ai_allowance_used_isk: 2000,
    });
  });

  test('AI within the allowance and no hosting is nothing to bill — refused, no number used', async () => {
    const res = await pt([{ type: 'ai', description: 'Pantanalestur', cost_isk: 2000 }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Nothing to bill/);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM invoices`);
    expect(rows[0].n).toBe(0);
    // The number series is gapless: the refused attempt consumed nothing.
    const ok = await pt([{ type: 'hosting', description: 'TEST', cost_isk: 100 }]);
    const again = await issue({ account_id: account.id, kind: 'overage', units: 1, unit_price_isk: 6000 });
    expect(Number(again.body.invoice.invoice_number)).toBe(Number(ok.body.invoice.invoice_number) + 1);
  });
});

// ── Commission ───────────────────────────────────────────────────────────────

describe('no commission', () => {
  test('no commission_events row and no commission.recorded audit, though the account has an owner and a rate', async () => {
    const res = await pt([{ type: 'hosting', description: 'TEST-umhverfi', cost_isk: 20000 }]);
    expect(res.status).toBe(201);
    expect(res.body.commission).toBeNull();
    expect(await commissionCount()).toBe(0);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM staff_audit_log WHERE action = 'commission.recorded' AND entity_id = $1`,
      [String(account.id)]
    );
    expect(rows[0].n).toBe(0);
  });

  test('a paid pass-through invoice leaves the seller statement exactly as the contract month alone makes it', async () => {
    const rec = await issue({ account_id: account.id, kind: 'recurring', period: '2026-09' });
    expect(rec.status).toBe(201);
    const pass = await pt([
      { type: 'hosting', description: 'TEST-umhverfi', cost_isk: 20000 },
      { type: 'ai', description: 'Pantanalestur', cost_isk: 9000 },
    ]);
    expect(pass.status).toBe(201);
    await pay(rec.body.invoice.id, Number(rec.body.invoice.total_gross), 'rec');
    await pay(pass.body.invoice.id, Number(pass.body.invoice.total_gross), 'pass');

    expect(await commissionCount()).toBe(1);
    const events = await request(app).get(`${ACCOUNTS}/${account.id}/commission`).set('Cookie', adminCookie);
    expect(events.status).toBe(200);
    expect(events.body.events).toHaveLength(1);
    expect(events.body.events[0].kind).toBe('recurring');

    const pv = await request(app).post(`${C}/statements/preview`).set('Cookie', adminCookie)
      .send({ seller_user_id: A, period: todayIso().slice(0, 7) });
    expect(pv.status).toBe(200);
    // 10 % of the 89.000 contract month and nothing of the pass-through.
    expect(Number(pv.body.preview.earned_isk)).toBe(8900);
  });
});

// ── The books ────────────────────────────────────────────────────────────────

engineOnly('the journal entry (D-022 worked example)', () => {
  test('balances: AR debit = gross, 4110 credit = net, 2200 credit = VSK', async () => {
    const res = await pt([
      { type: 'hosting', description: 'TEST-umhverfi', cost_isk: 10000 },
      { type: 'ai', description: 'Pantanalestur', cost_isk: 3500 },
    ]);
    const { rows } = await db.query(
      `SELECT la.code, jl.debit, jl.credit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN ledger_accounts la ON la.id = jl.account_id
        WHERE je.source_type = 'invoice' AND je.source_id = $1`,
      [res.body.invoice.id]
    );
    const debit = rows.reduce((s, r) => s + Number(r.debit), 0);
    const creditSum = rows.reduce((s, r) => s + Number(r.credit), 0);
    expect(debit).toBe(creditSum);
    const by = {};
    for (const r of rows) by[r.code] = (by[r.code] || 0) + Number(r.debit) - Number(r.credit);
    expect(by).toEqual({ 1100: 16399, 4110: -13225, 2200: -3174 });
  });

  test('the invoice renders as a PDF and exports as Peppol UBL with one line per cost', async () => {
    const res = await pt([
      { type: 'hosting', description: 'TEST-umhverfi', cost_isk: 10000 },
      { type: 'ai', description: 'Pantanalestur', cost_isk: 3500 },
    ]);
    const id = res.body.invoice.id;
    const pdf = await request(app).get(`${BOOKS}/invoices/${id}/pdf`).set('Cookie', adminCookie);
    expect(pdf.status).toBe(200);
    const ubl = await request(app).get(`${BOOKS}/invoices/${id}/ubl.xml`).set('Cookie', adminCookie)
      .buffer(true).parse((r, cb) => { let d = ''; r.on('data', c => { d += c; }); r.on('end', () => cb(null, d)); });
    expect(ubl.status).toBe(200);
    expect((ubl.body.match(/<cac:InvoiceLine>/g) || [])).toHaveLength(2);
    expect(ubl.body).toMatch(/<cbc:TaxAmount currencyID="ISK">3174\.00<\/cbc:TaxAmount>/);
    expect(ubl.body).not.toMatch(/PayableRoundingAmount/);
  });
});

// ── The duplicate guard (migration 122) ─────────────────────────────────────

describe('one pass-through invoice per account per period', () => {
  const line = [{ type: 'hosting', description: 'TEST-umhverfi', cost_isk: 5000 }];

  test('a second for the same period is 409; another period, or a contract month, is fine', async () => {
    expect((await pt(line)).status).toBe(201);
    const dup = await pt(line);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already has a pass-through invoice for 2026-09/);
    expect((await pt(line, '2026-10')).status).toBe(201);
    // The recurring index is its own: a contract month for the same period.
    expect((await issue({ account_id: account.id, kind: 'recurring', period: '2026-09' })).status).toBe(201);
  });

  test('a FULL credit note frees the period for a corrected invoice; a partial one does not', async () => {
    const first = await pt(line);
    const gross = Number(first.body.invoice.total_gross);
    expect([200, 201]).toContain((await credit(first.body.invoice.id, 100)).status);
    expect((await pt(line)).status).toBe(409);
    expect([200, 201]).toContain((await credit(first.body.invoice.id, gross - 100)).status);
    const { rows: [st] } = await db.query(`SELECT status FROM invoices WHERE id = $1`, [first.body.invoice.id]);
    expect(st.status).toBe('credited');
    const corrected = await pt([{ type: 'hosting', description: 'TEST-umhverfi (leiðrétt)', cost_isk: 5500 }]);
    expect(corrected.status).toBe(201);
    expect(Number(corrected.body.invoice.subtotal_net)).toBe(mk(5500));
  });

  test('two concurrent issues for one period: exactly one lands', async () => {
    const [a, b] = await Promise.all([pt(line), pt(line)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });
});

// ── Validation + access ──────────────────────────────────────────────────────

describe('validation', () => {
  const ok = { type: 'hosting', description: 'TEST', cost_isk: 1000 };
  test.each([
    ['no period', { period: undefined, lines: [ok] }],
    ['a bad period', { period: '2026-13', lines: [ok] }],
    ['no lines', { lines: undefined }],
    ['an empty list', { lines: [] }],
    ['lines not a list', { lines: { 0: ok } }],
    ['a line not an object', { lines: ['hosting'] }],
    ['an unknown type', { lines: [{ ...ok, type: 'email' }] }],
    ['no description', { lines: [{ ...ok, description: '   ' }] }],
    ['a description over 120 characters', { lines: [{ ...ok, description: 'x'.repeat(121) }] }],
    ['a zero cost', { lines: [{ ...ok, cost_isk: 0 }] }],
    ['a negative cost', { lines: [{ ...ok, cost_isk: -5 }] }],
    ['a fractional cost', { lines: [{ ...ok, cost_isk: 10.5 }] }],
    ['a non-numeric cost', { lines: [{ ...ok, cost_isk: 'mikið' }] }],
    ['a cost given as a list', { lines: [{ ...ok, cost_isk: [1000] }] }],
    ['21 lines', { lines: Array.from({ length: 21 }, () => ok) }],
  ])('%s → 400, nothing issued', async (_name, patch) => {
    const body = { account_id: account.id, kind: 'passthrough', period: '2026-09', lines: [ok], ...patch };
    if (patch.period === undefined && 'period' in patch) delete body.period;
    if (patch.lines === undefined && 'lines' in patch) delete body.lines;
    const res = await issue(body);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.code).toBe(400);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM invoices`);
    expect(rows[0].n).toBe(0);
  });

  test('an unknown account is 404', async () => {
    const res = await issue({ account_id: 999999, kind: 'passthrough', period: '2026-09', lines: [ok] });
    expect(res.status).toBe(404);
  });
});

describe('access', () => {
  const body = () => ({
    account_id: account.id, kind: 'passthrough', period: '2026-09',
    lines: [{ type: 'hosting', description: 'TEST', cost_isk: 1000 }],
  });
  test('the account\'s own seller 403, a plain user 403, unauthenticated 401', async () => {
    expect((await issue(body(), sellerA)).status).toBe(403);
    expect((await issue(body(), userCookie)).status).toBe(403);
    expect((await request(app).post(`${BOOKS}/invoices/service`).send(body())).status).toBe(401);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM invoices`);
    expect(rows[0].n).toBe(0);
  });

  test('the preview terms come with the account for an admin only', async () => {
    const admin = await request(app).get(`${ACCOUNTS}/${account.id}`).set('Cookie', adminCookie);
    expect(admin.body.passthrough_terms).toEqual({ markup_bp: T.markupBp, ai_allowance_isk: T.aiAllowanceIsk, vat_rate: 24 });
    const seller = await request(app).get(`${ACCOUNTS}/${account.id}`).set('Cookie', sellerA);
    expect(seller.status).toBe(200);
    expect(seller.body.passthrough_terms).toBeUndefined();
  });
});

// ── Migration 122 ────────────────────────────────────────────────────────────

describe('migration 122_passthrough_invoice', () => {
  const m = migrations.find(x => x.name === '122_passthrough_invoice');

  test('is the engine entry, and running it again changes nothing', async () => {
    expect(m).toBeTruthy();
    const client = await db.pool.connect();
    try {
      for (let run = 0; run < 2; run++) {
        await client.query('BEGIN');
        for (const sql of m.statements) await client.query(sql);
        await client.query('COMMIT');
      }
    } finally { client.release(); }
    const { rows: idx } = await db.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uniq_invoices_account_passthrough_period'`
    );
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toMatch(/UNIQUE/);
    const { rows: ck } = await db.query(
      `SELECT convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'invoices_service_kind_check' AND conrelid = 'invoices'::regclass`
    );
    expect(ck).toHaveLength(1);
    expect(ck[0].def).toMatch(/passthrough/);
  });

  test('the CHECK refuses a service_kind outside the vocabulary', async () => {
    const res = await pt([{ type: 'hosting', description: 'TEST', cost_isk: 1000 }]);
    // A draft invoice may still change (the 072 trigger freezes issued ones),
    // so try the vocabulary on a fresh draft copy of the row's shape instead:
    // the constraint is table-level, so an INSERT … SELECT exercises it.
    await expect(db.query(
      `INSERT INTO invoices (series, invoice_number, seller_name, seller_kennitala, seller_vat_number,
         seller_address, customer_name, customer_kennitala, customer_email, customer_address,
         customer_country, issued_at, due_at, terms_days, original_currency, fx_rate,
         subtotal_net, vat_total, total_gross, discount_total, shipping_gross, status, created_by,
         account_id, service_kind, service_period)
       SELECT series, invoice_number + 1000, seller_name, seller_kennitala, seller_vat_number,
         seller_address, customer_name, customer_kennitala, customer_email, customer_address,
         customer_country, issued_at, due_at, terms_days, original_currency, fx_rate,
         subtotal_net, vat_total, total_gross, discount_total, shipping_gross, 'draft', created_by,
         account_id, 'bogus', service_period
         FROM invoices WHERE id = $1`,
      [res.body.invoice.id]
    )).rejects.toMatchObject({ code: '23514' });
  });
});
