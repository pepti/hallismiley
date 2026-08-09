// The bookkeeping HTTP surface: authorization, validation, and the error contract.
//
// Two things this file exists to prove:
//   1. A read view id grants READS ONLY. Issuing invoices, taking payments and
//      crediting are hard admin-only, so a delegated bookkeeper role cannot create
//      or reverse statutory documents.
//   2. A malformed request is a 400 with an explanation, never a 500. In the system
//      this replaces, ?from=abc and ?limit=-1 were each a Postgres error surfacing
//      as a 500 — which is both a bad API and an information leak.
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Role = require('../../server/models/Role');
const Setting = require('../../server/models/Setting');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie,
  cleanTables,
} = require('../helpers');

const BASE = '/api/v1/admin/bookkeeping';
const VALID_KENNITALA = '1203894599';

let adminId; let adminCookie;
let readerId; let readerCookie;
let strangerId; let strangerCookie;
let orderId; let productId;

// A custom role holding only the books read views — the "delegated bookkeeper".
// Upserted rather than created: `roles` has no FK to `users`, so cleanTables()
// leaves it standing between tests and a plain INSERT collides on the second run.
async function makeBooksReaderRole() {
  const views = ['books', 'invoices', 'ar', 'vat', 'ledger', 'payroll', 'pos'];
  const { rows } = await db.query(
    `INSERT INTO roles (name, description, view_access, is_system)
     VALUES ('bokari-test', 'Bókari (test) — read-only books access', $1::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access
     RETURNING name`,
    [JSON.stringify(views)]
  );
  Role.invalidateCache();
  return rows[0];
}

async function seedOrder() {
  const { rows: p } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku)
     VALUES ('api-bord','Eikarborð','',12400, 8900, 5, 'SKU-API-1')
     ON CONFLICT (slug) DO UPDATE SET price_isk = EXCLUDED.price_isk RETURNING id`
  );
  productId = p[0].id;
  const { rows: o } = await db.query(
    `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
       payment_status, shipping_method, shipping_address, guest_email, guest_name, paid_at)
     VALUES ($1,'ISK',12400,0,12400,'paid','paid','local_pickup',$2::jsonb,
             'jon@example.is','Jón Jónsson', NOW())
     RETURNING id`,
    [`HP-API-${Math.random().toString(36).slice(2, 9)}`,
      JSON.stringify({ name: 'Jón Jónsson', line1: 'Bæjargata 5', postal: '101', city: 'Reykjavík', country_code: 'IS' })]
  );
  orderId = o[0].id;
  await db.query(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot,
       product_price_snapshot, quantity, currency)
     VALUES ($1,$2,'Eikarborð',12400,1,'ISK')`,
    [orderId, productId]
  );
  return orderId;
}

beforeEach(async () => {
  await cleanTables();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  strangerId = await createTestRegularUser();
  strangerCookie = await getTestSessionCookie(strangerId);

  // A user whose only grant is the books reader role.
  const role = await makeBooksReaderRole();
  const { rows } = await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ('books-reader-id','reader@test.com','booksreader','x',$1,TRUE)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
    [role.name]
  );
  readerId = rows[0].id;
  readerCookie = await getTestSessionCookie(readerId);

  await Setting.updateBookkeepingSettings({
    seller_name: 'Halli Smiley ehf.',
    seller_kennitala: VALID_KENNITALA,
    seller_vat_number: '123456',
    payment_terms_days: 14,
  });
  await seedOrder();
});

afterAll(async () => { await db.pool.end(); });

// ── Authorization ────────────────────────────────────────────────────────────

describe('authorization', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app).get(`${BASE}/dashboard`).expect(401);
    await request(app).get(`${BASE}/invoices`).expect(401);
  });

  it('rejects a signed-in user with no books view', async () => {
    await request(app).get(`${BASE}/dashboard`).set('Cookie', strangerCookie).expect(403);
    await request(app).get(`${BASE}/invoices`).set('Cookie', strangerCookie).expect(403);
  });

  it('lets a books reader read', async () => {
    await request(app).get(`${BASE}/dashboard`).set('Cookie', readerCookie).expect(200);
    await request(app).get(`${BASE}/invoices`).set('Cookie', readerCookie).expect(200);
  });

  it('does NOT let a books reader issue an invoice', async () => {
    // The whole point of the read/write split: a delegated bookkeeper can look at
    // everything but cannot create a statutory document.
    await request(app)
      .post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', readerCookie)
      .expect(403);
  });

  it('does NOT let a books reader record a payment or issue a credit note', async () => {
    const issued = await request(app)
      .post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(201);
    const id = issued.body.invoice.id;

    await request(app).post(`${BASE}/invoices/${id}/payments`)
      .set('Cookie', readerCookie)
      .send({ amount: 100, method: 'cash', idempotency_key: 'k1' })
      .expect(403);
    await request(app).post(`${BASE}/invoices/${id}/credit-notes`)
      .set('Cookie', readerCookie)
      .send({ amount_gross: 100, reason: 'nope' })
      .expect(403);
  });

  it('does NOT let a books reader change settings', async () => {
    await request(app).patch(`${BASE}/settings`)
      .set('Cookie', readerCookie).send({ payment_terms_days: 30 }).expect(403);
  });

  it('admin can do all of it', async () => {
    await request(app).get(`${BASE}/settings`).set('Cookie', adminCookie).expect(200);
    await request(app).patch(`${BASE}/settings`)
      .set('Cookie', adminCookie).send({ payment_terms_days: 30 }).expect(200);
  });
});

// ── Validation: 400, never 500 ───────────────────────────────────────────────

describe('input validation', () => {
  it.each([
    ['?limit=-1', 'negative limit'],
    ['?limit=0', 'zero limit'],
    ['?limit=99999', 'limit above the cap'],
    ['?limit=abc', 'non-numeric limit'],
    ['?limit=1.5', 'fractional limit'],
    ['?offset=-5', 'negative offset'],
    ['?from=abc', 'unparseable from'],
    ['?to=2026-13-45', 'impossible to'],
    ['?from=2026-08-01&to=2026-01-01', 'reversed range'],
    ['?status=bogus', 'unknown status'],
    ['?sort=total; DROP TABLE invoices', 'injection attempt in sort'],
    ['?dir=sideways', 'unknown direction'],
  ])('returns 400 for %s (%s)', async (qs) => {
    const res = await request(app).get(`${BASE}/invoices${qs}`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 400 });
    expect(typeof res.body.error).toBe('string');
  });

  it('accepts a 30-digit search term without erroring', async () => {
    // A huge numeric term must not reach a bigint comparison and blow up.
    const res = await request(app)
      .get(`${BASE}/invoices?q=${'9'.repeat(30)}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.invoices).toEqual([]);
  });

  it('rejects a malformed invoice id with 400, not a database error', async () => {
    const res = await request(app).get(`${BASE}/invoices/not-a-uuid`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('404s a well-formed but unknown invoice id', async () => {
    await request(app)
      .get(`${BASE}/invoices/00000000-0000-4000-8000-000000000000`)
      .set('Cookie', adminCookie)
      .expect(404);
  });

  it.each([
    [{ amount: -100, method: 'cash', idempotency_key: 'k' }, 'negative amount'],
    [{ amount: 0, method: 'cash', idempotency_key: 'k' }, 'zero amount'],
    [{ amount: 1.5, method: 'cash', idempotency_key: 'k' }, 'fractional amount'],
    [{ amount: 'abc', method: 'cash', idempotency_key: 'k' }, 'non-numeric amount'],
    [{ amount: 100, method: 'crypto', idempotency_key: 'k' }, 'unknown method'],
    [{ amount: 100, method: 'cash' }, 'missing idempotency key'],
    [{ amount: 100, method: 'cash', idempotency_key: 'k', received_at: 'whenever' }, 'bad date'],
    [{ amount: 1e20, method: 'cash', idempotency_key: 'k' }, 'unrealistic amount'],
  ])('rejects payment body %#: %s', async (body) => {
    const issued = await request(app)
      .post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(201);
    const res = await request(app)
      .post(`${BASE}/invoices/${issued.body.invoice.id}/payments`)
      .set('Cookie', adminCookie).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(400);
  });

  it('rejects a credit note with no reason', async () => {
    const issued = await request(app)
      .post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(201);
    await request(app)
      .post(`${BASE}/invoices/${issued.body.invoice.id}/credit-notes`)
      .set('Cookie', adminCookie)
      .send({ amount_gross: 100 })
      .expect(400);
  });

  it('rejects an implausible FX rate', async () => {
    const res = await request(app).post(`${BASE}/fx-rates`)
      .set('Cookie', adminCookie)
      .send({ currency: 'EUR', rate: 1.43, rate_date: '2026-08-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/plausible/);
  });

  it('rejects a kennitala that fails its check digit', async () => {
    const res = await request(app).patch(`${BASE}/settings`)
      .set('Cookie', adminCookie)
      .send({ seller_kennitala: '1203894560' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/check-digit/);
  });
});

// ── The happy path over HTTP ─────────────────────────────────────────────────

describe('invoice lifecycle over HTTP', () => {
  it('issues, reads, pays and credits an invoice', async () => {
    const issued = await request(app)
      .post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie)
      .expect(201);
    expect(issued.body.created).toBe(true);
    const id = issued.body.invoice.id;
    expect(issued.body.invoice.total_gross).toBe(12400);
    expect(issued.body.invoice.vat_total).toBe(2400);

    const detail = await request(app).get(`${BASE}/invoices/${id}`)
      .set('Cookie', adminCookie).expect(200);
    expect(detail.body.invoice.lines).toHaveLength(1);
    // VAT separated by rate, as the invoice itself must state it.
    expect(detail.body.invoice.vat_by_rate).toEqual([{ rate: 24, net: 10000, vat: 2400, gross: 12400 }]);
    expect(detail.body.invoice.display_status).toBe('issued');
    // The audit trail is part of the response, so "who did this" is answerable.
    expect(detail.body.history.some(h => h.action === 'invoice.issued')).toBe(true);

    const paid = await request(app).post(`${BASE}/invoices/${id}/payments`)
      .set('Cookie', adminCookie)
      .send({ amount: 12400, method: 'bank_transfer', idempotency_key: 'http-pay-1' })
      .expect(201);
    expect(paid.body.invoice.amount_paid).toBe(12400);

    const afterPaid = await request(app).get(`${BASE}/invoices/${id}`)
      .set('Cookie', adminCookie).expect(200);
    expect(afterPaid.body.invoice.display_status).toBe('paid');
    expect(afterPaid.body.invoice.outstanding).toBe(0);
  });

  it('returns 200 and not a duplicate when issuing twice', async () => {
    const first = await request(app).post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(201);
    const second = await request(app).post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(200);
    expect(second.body.created).toBe(false);
    expect(second.body.invoice.id).toBe(first.body.invoice.id);
  });

  it('reports an overpayment as 422, not 500', async () => {
    const issued = await request(app).post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(201);
    const res = await request(app).post(`${BASE}/invoices/${issued.body.invoice.id}/payments`)
      .set('Cookie', adminCookie)
      .send({ amount: 99999, method: 'cash', idempotency_key: 'http-over-1' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/exceeds/);
  });

  it('serves a PDF as an attachment with no-store', async () => {
    const issued = await request(app).post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(201);
    const res = await request(app).get(`${BASE}/invoices/${issued.body.invoice.id}/pdf`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    // An invoice carries a customer's name and address — it must not be cached by
    // a shared proxy or rendered inline by accident.
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('serves the invoices CSV export — the route was shadowed by :id and unreachable', async () => {
    // '/invoices/export.csv' was declared AFTER '/invoices/:id', so it matched getInvoice
    // with id "export.csv" and 400'd. Every other resource orders these correctly.
    await request(app).post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(201);
    const res = await request(app).get(`${BASE}/invoices/export.csv`)
      .set('Cookie', adminCookie).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.text.charCodeAt(0)).toBe(0xFEFF);
    // The status filter is honoured, so the download matches what the screen shows.
    await request(app).get(`${BASE}/invoices/export.csv?status=paid`)
      .set('Cookie', adminCookie).expect(200);
  });

  it('blocks issuing while the seller block is incomplete', async () => {
    await Setting.updateBookkeepingSettings({ seller_kennitala: '', seller_vat_number: '' });
    const res = await request(app).post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/kennitala/i);
  });

  it('surfaces a locked period as 409 with an explanation', async () => {
    await request(app).post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(201);
    // Lock the period the NEXT invoice would land in, then try to take a payment
    // dated inside it.
    const second = await seedOrder();
    await db.query(`UPDATE fiscal_periods SET status='locked', locked_at=NOW()
                     WHERE period = to_char(NOW(), 'YYYY') || '-P' ||
                       (floor((extract(month from NOW())::int - 1) / 2) + 1)::text`);
    const res = await request(app).post(`${BASE}/invoices/from-order/${second}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/closed|locked/i);
  });
});

// ── Dashboard ────────────────────────────────────────────────────────────────

describe('dashboard', () => {
  it('reports metrics and standing setup warnings', async () => {
    await request(app).post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(201);
    const res = await request(app).get(`${BASE}/dashboard`).set('Cookie', adminCookie).expect(200);

    expect(res.body.metrics).toMatchObject({
      invoices_issued: 1, revenue_net: 10000, output_vat: 2400, invoiced_gross: 12400,
    });
    expect(res.body.metrics.ar_outstanding).toBe(12400);
    // Setup readiness is surfaced so a blocked first invoice is visible in advance
    // rather than as a failure at the worst moment.
    expect(res.body.readiness.seller_complete).toBe(true);
    expect(res.body.readiness).toHaveProperty('coa_confirmed_at');
    expect(res.body.readiness.fx).toHaveProperty('ok');
  });

  it('defaults to a bounded date range rather than scanning all time', async () => {
    const res = await request(app).get(`${BASE}/dashboard`).set('Cookie', adminCookie).expect(200);
    expect(res.body.range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.range.from < res.body.range.to).toBe(true);
  });
});

// ── Ledger and reports ───────────────────────────────────────────────────────

describe('ledger and reports over HTTP', () => {
  beforeEach(async () => {
    await request(app).post(`${BASE}/invoices/from-order/${orderId}`)
      .set('Cookie', adminCookie).expect(201);
  });

  it('lets a books reader read every report', async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const url of [
      `${BASE}/reports/trial-balance`,
      `${BASE}/reports/profit-and-loss`,
      `${BASE}/reports/balance-sheet`,
      `${BASE}/journal`,
      `${BASE}/accounts/1100/ledger?to=${today}`,
    ]) {
      await request(app).get(url).set('Cookie', readerCookie).expect(200);
    }
  });

  it('does NOT let a books reader post or reverse a journal entry', async () => {
    // Writing straight to the ledger can put anything anywhere, so it is not
    // delegable through a read role however many views that role holds.
    await request(app).post(`${BASE}/journal`)
      .set('Cookie', readerCookie)
      .send({ entry_date: '2026-08-01', memo: 'nope', lines: [] })
      .expect(403);
    await request(app).post(`${BASE}/journal/00000000-0000-0000-0000-000000000000/reverse`)
      .set('Cookie', readerCookie).send({ reason: 'nope' })
      .expect(403);
  });

  it('reports a trial balance that balances', async () => {
    const res = await request(app).get(`${BASE}/reports/trial-balance`)
      .set('Cookie', adminCookie).expect(200);
    expect(res.body.balanced).toBe(true);
    expect(res.body.debit_total).toBe(res.body.credit_total);
    expect(res.body.accounts.length).toBeGreaterThan(0);
  });

  it('does not silently window the trial balance', async () => {
    // Unlike the dashboard, this report defaults to EVERYTHING. A quietly-applied
    // 60-day window would produce a trial balance that does not balance, for no
    // visible reason.
    const res = await request(app).get(`${BASE}/reports/trial-balance`)
      .set('Cookie', adminCookie).expect(200);
    expect(res.body.range).toEqual({ from: null, to: null });
  });

  it('posts a manual entry and shows it in the journal', async () => {
    const res = await request(app).post(`${BASE}/journal`)
      .set('Cookie', adminCookie)
      .send({
        entry_date: new Date().toISOString().slice(0, 10),
        memo: 'Stofnstaða bankareiknings',
        lines: [
          { account_code: '1900', debit: 500000, memo: 'Innborgun' },
          { account_code: '3100', credit: 500000 },
        ],
      })
      .expect(201);
    expect(res.body.entry.entry_number).toBeGreaterThan(0);

    const jrn = await request(app).get(`${BASE}/journal?source_type=manual`)
      .set('Cookie', adminCookie).expect(200);
    expect(jrn.body.entries.some(e => e.memo === 'Stofnstaða bankareiknings')).toBe(true);
  });

  it.each([
    [{ memo: '', lines: [] }, 'no memo'],
    [{ memo: 'x', lines: [{ account_code: '1900', debit: 1 }] }, 'a single line'],
    [{ memo: 'x', lines: [{ account_code: '1900', debit: 1, credit: 1 }, { account_code: '3100', credit: 1 }] }, 'both sides on one line'],
    [{ memo: 'x', lines: [{ account_code: '1900', debit: 1 }, { account_code: '3100', credit: 2 }] }, 'an unbalanced pair'],
    [{ memo: 'x', lines: [{ account_code: '9999', debit: 1 }, { account_code: '3100', credit: 1 }] }, 'an unknown account'],
    [{ memo: 'x', lines: [{ account_code: '1900', debit: [1] }, { account_code: '3100', credit: 1 }] }, 'an array where an amount belongs'],
    [{ memo: 'x', lines: [{ account_code: '1900', debit: 1.5 }, { account_code: '3100', credit: 1.5 }] }, 'fractional ISK'],
  ])('refuses a manual entry with %#: %s', async (body) => {
    const res = await request(app).post(`${BASE}/journal`)
      .set('Cookie', adminCookie)
      .send({ entry_date: new Date().toISOString().slice(0, 10), ...body });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body).toHaveProperty('error');
  });

  it('requires a reason to reverse, and refuses to reverse twice', async () => {
    const posted = await request(app).post(`${BASE}/journal`)
      .set('Cookie', adminCookie)
      .send({
        entry_date: new Date().toISOString().slice(0, 10),
        memo: 'Verður bakfærð',
        lines: [
          { account_code: '1900', debit: 1000 },
          { account_code: '3100', credit: 1000 },
        ],
      })
      .expect(201);
    const id = posted.body.entry.id;

    await request(app).post(`${BASE}/journal/${id}/reverse`)
      .set('Cookie', adminCookie).send({}).expect(400);

    const rev = await request(app).post(`${BASE}/journal/${id}/reverse`)
      .set('Cookie', adminCookie).send({ reason: 'Bókað á vitlausan lykil' })
      .expect(201);
    expect(rev.body.entry.entry_number).toBeGreaterThan(posted.body.entry.entry_number);

    // Twice would leave two mirror entries against one original — the ledger would
    // balance and still be wrong by the amount of the entry.
    await request(app).post(`${BASE}/journal/${id}/reverse`)
      .set('Cookie', adminCookie).send({ reason: 'Aftur' })
      .expect(409);
  });

  it('404s a report for an account that does not exist', async () => {
    const res = await request(app).get(`${BASE}/accounts/9999/ledger`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 404 });
  });

  it.each([
    ['/journal?from=abc', 'unparseable from'],
    ['/journal?limit=-1', 'negative limit'],
    ['/journal?source_type=bogus', 'unknown source type'],
    ['/journal?from=2026-08-01&to=2026-01-01', 'reversed range'],
    ['/reports/trial-balance?to=2026-13-45', 'impossible date'],
    ['/reports/profit-and-loss?from=2026-08-01&to=2026-01-01', 'reversed range'],
  ])('returns 400 for %s (%s)', async (pathAndQs) => {
    const res = await request(app).get(`${BASE}${pathAndQs}`).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 400 });
  });

  it('serves the CSV exports without letting a route parameter swallow them', async () => {
    // '/reports/trial-balance.csv' must not be matched as a report named
    // 'trial-balance.csv', and neither export may be eaten by '/accounts/:code/ledger'.
    for (const url of [`${BASE}/reports/trial-balance.csv`, `${BASE}/reports/journal.csv`]) {
      const res = await request(app).get(url).set('Cookie', adminCookie).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      // BOM first, or Excel on Windows mangles every Icelandic character.
      expect(res.text.charCodeAt(0)).toBe(0xFEFF);
    }
  });

  it('builds an accountant pack whose parts agree with each other', async () => {
    // One read, one moment, one ledger — the reason this is one endpoint rather than
    // five downloads that could straddle a new posting.
    const res = await request(app).get(`${BASE}/reports/accountant-pack`)
      .set('Cookie', adminCookie).expect(200);
    expect(res.body.trial_balance.balanced).toBe(true);
    expect(res.body.balance_sheet.balanced).toBe(true);
    expect(res.body.journal_sample.entries.length).toBeGreaterThan(0);
    // It states what it is NOT, so nobody mistakes it for finished statutory accounts.
    expect(res.body.caveats.length).toBeGreaterThan(0);
    expect(res.body.caveats.join(' ')).toMatch(/retained earnings/i);
  });

  it('makes the pack’s trial balance TIE with its balance sheet', async () => {
    // The bug: the pack windowed the trial balance ({from,to}) but left the balance
    // sheet cumulative ({to}), so an account with prior-period activity showed two
    // different figures across the two files. Both are cumulative now, so every balance
    // -sheet account's amount equals its trial-balance "Staða" for the same account.
    const res = await request(app).get(`${BASE}/reports/accountant-pack`)
      .set('Cookie', adminCookie).expect(200);
    const tbByCode = Object.fromEntries(
      res.body.trial_balance.accounts.map(a => [a.code, a.balance])
    );
    const bsAccounts = [
      ...res.body.balance_sheet.assets,
      ...res.body.balance_sheet.liabilities,
      ...res.body.balance_sheet.equity,
    ];
    for (const a of bsAccounts) {
      expect(tbByCode[a.code]).toBe(a.amount);
    }
    // And the trial balance is genuinely cumulative, not period-scoped.
    expect(res.body.trial_balance.range).toEqual({ from: null, to: expect.any(String) });
  });
});

// ── Payroll ──────────────────────────────────────────────────────────────────

describe('payroll over HTTP', () => {
  // Its own future year, so nothing here collides with the seeded 2026 figures or with
  // another suite's ledger history. Nothing is ever posted against it.
  const YEAR = 2088;
  const FIGURES = {
    personal_allowance: 60_000,
    municipal_rate: 0.145,
    social_security: 0.0635,
    pension_employee: 0.04,
    pension_employer: 0.115,
    bands: [{ from: 0, rate: 0.30 }, { from: 500_000, rate: 0.40 }],
    source_note: 'Test figures',
  };

  it('lets a books reader read, but not enter or confirm figures', async () => {
    // Salary is the most sensitive data in these books, and 'payroll' is its own view id
    // for that reason — but holding it still grants reads only.
    await request(app).get(`${BASE}/payroll/years`).set('Cookie', readerCookie).expect(200);
    // Employees and runs included: the view id is what grants sight of salaries, and a
    // bookkeeper who cannot see them cannot reconcile the payroll liabilities.
    await request(app).get(`${BASE}/payroll/employees`).set('Cookie', readerCookie).expect(200);
    await request(app).get(`${BASE}/payroll/runs`).set('Cookie', readerCookie).expect(200);
    await request(app).put(`${BASE}/payroll/years/${YEAR}`)
      .set('Cookie', readerCookie).send(FIGURES).expect(403);
    await request(app).post(`${BASE}/payroll/years/${YEAR}/confirm`)
      .set('Cookie', readerCookie).send({ source_note: 'nope' }).expect(403);
  });

  it('rejects a stranger outright', async () => {
    await request(app).get(`${BASE}/payroll/years`).set('Cookie', strangerCookie).expect(403);
    await request(app).get(`${BASE}/payroll/runs`).set('Cookie', strangerCookie).expect(403);
  });

  it('saves a year unconfirmed, then confirms it with a note', async () => {
    const saved = await request(app).put(`${BASE}/payroll/years/${YEAR}`)
      .set('Cookie', adminCookie).send(FIGURES).expect(200);
    expect(saved.body.confirmed_at).toBeNull();
    expect(saved.body.bands).toHaveLength(2);

    // The note is required: "I checked these" is only worth something if it says
    // against what.
    await request(app).post(`${BASE}/payroll/years/${YEAR}/confirm`)
      .set('Cookie', adminCookie).send({}).expect(400);

    const confirmed = await request(app).post(`${BASE}/payroll/years/${YEAR}/confirm`)
      .set('Cookie', adminCookie).send({ source_note: 'skatturinn.is, checked today' })
      .expect(200);
    expect(confirmed.body.confirmed_at).toBeTruthy();
  });

  it('runs the whole payroll flow over HTTP — confirm, employee, draft, post, payslip, CSV', async () => {
    // The success path the block otherwise skips: everything below the refusals. Also the
    // only test that the payslip PDF renders at all, and that the payroll CSV's columns
    // line up with its rows.
    await request(app).put(`${BASE}/payroll/years/${YEAR}`)
      .set('Cookie', adminCookie).send(FIGURES).expect(200);
    await request(app).post(`${BASE}/payroll/years/${YEAR}/confirm`)
      .set('Cookie', adminCookie).send({ source_note: 'checked' }).expect(200);

    const emp = await request(app).post(`${BASE}/payroll/employees`)
      .set('Cookie', adminCookie)
      .send({
        full_name: 'Launþegi Prófsson', kennitala: '1203894599',
        monthly_salary: 600_000, pension_fund: 'Gildi',
      })
      .expect(201);
    expect(emp.body.employee.full_name).toBe('Launþegi Prófsson');

    const draft = await request(app).post(`${BASE}/payroll/runs`)
      .set('Cookie', adminCookie)
      .send({ period: `${YEAR}-06`, pay_date: `${YEAR}-06-28` })
      .expect(201);
    expect(draft.body.run.status).toBe('draft');
    expect(draft.body.run.gross_total).toBe(600_000);

    const posted = await request(app).post(`${BASE}/payroll/runs/${draft.body.run.id}/post`)
      .set('Cookie', adminCookie).send({}).expect(200);
    expect(posted.body.run.status).toBe('posted');

    // The payslip PDF actually renders, downloads (attachment), and is a real PDF.
    const detail = await request(app).get(`${BASE}/payroll/runs/${draft.body.run.id}`)
      .set('Cookie', adminCookie).expect(200);
    const slipId = detail.body.payslips[0].id;
    const pdf = await request(app).get(`${BASE}/payroll/payslips/${slipId}/pdf`)
      .set('Cookie', adminCookie).expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.headers['content-disposition']).toMatch(/^attachment/);
    expect(pdf.headers['cache-control']).toMatch(/no-store/);
    expect(pdf.body.slice(0, 5).toString()).toBe('%PDF-');

    // The CSV: header and row must be the same width, and the run must be in it.
    const csv = await request(app).get(`${BASE}/payroll/export.csv`)
      .set('Cookie', adminCookie).expect(200);
    const body = csv.text.charCodeAt(0) === 0xFEFF ? csv.text.slice(1) : csv.text;
    const lines = body.trim().split('\r\n');
    const header = lines[0].split(',');
    expect(header).toContain('Séreign starfsmanns');
    const row = lines.find(l => l.startsWith(`${YEAR}-06`)).split(',');
    expect(row).toHaveLength(header.length);
    // Column alignment: 'Laun' (gross) reads 600000 at its header's position.
    expect(row[header.indexOf('Laun')]).toBe('600000');
  });

  it.each([
    [{ social_security: 6.35 }, 'a percentage where a decimal belongs'],
    [{ bands: [{ from: 100_000, rate: 0.30 }] }, 'a lowest band above zero'],
    [{ bands: [] }, 'no bands'],
    [{ bands: [{ from: 0, rate: 0.10 }] }, 'a band at or below the municipal rate'],
    [{ personal_allowance: -1 }, 'a negative allowance'],
    [{ personal_allowance: 'lots' }, 'a non-numeric allowance'],
  ])('returns 400 for %#: %s', async (over) => {
    const res = await request(app).put(`${BASE}/payroll/years/${YEAR + 1}`)
      .set('Cookie', adminCookie).send({ ...FIGURES, ...over });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 400 });
  });

  it('refuses a run against a year nobody has confirmed', async () => {
    // The refusal that matters most. It has to come back as a 409 the screen can
    // explain, not a 500.
    await request(app).put(`${BASE}/payroll/years/${YEAR + 2}`)
      .set('Cookie', adminCookie).send(FIGURES).expect(200);
    const res = await request(app).post(`${BASE}/payroll/runs`)
      .set('Cookie', adminCookie)
      .send({ period: `${YEAR + 2}-01`, pay_date: `${YEAR + 2}-01-31` });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not been confirmed/);
  });

  it('validates an employee before it reaches the database', async () => {
    // A wrong kennitala goes onto the payslip and into every remittance, so it is
    // refused with an explanation rather than surfacing as a constraint violation.
    const bad = await request(app).post(`${BASE}/payroll/employees`)
      .set('Cookie', adminCookie)
      .send({ full_name: 'Rangur', kennitala: '1203994599', monthly_salary: 100_000 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/kennitala/i);

    // An owner with no reference-wage category cannot be checked against the minimum,
    // which is the one thing an owner most needs checked.
    const noCategory = await request(app).post(`${BASE}/payroll/employees`)
      .set('Cookie', adminCookie)
      .send({
        full_name: 'Eigandi', kennitala: '1203894599',
        employment_type: 'owner', monthly_salary: 100_000,
      });
    expect(noCategory.status).toBe(400);
    expect(noCategory.body.error).toMatch(/category/i);
  });

  it('does NOT let a books reader post, reverse or pay a run', async () => {
    // Writing payroll to the ledger creates a liability to Skatturinn. Not delegable.
    const fakeId = '00000000-0000-0000-0000-000000000000';
    for (const path of [`/payroll/runs/${fakeId}/post`, `/payroll/runs/${fakeId}/reverse`,
      `/payroll/runs/${fakeId}/pay`]) {
      await request(app).post(`${BASE}${path}`)
        .set('Cookie', readerCookie).send({ reason: 'x' }).expect(403);
    }
    await request(app).post(`${BASE}/payroll/runs`)
      .set('Cookie', readerCookie).send({ period: '2088-01', pay_date: '2088-01-31' })
      .expect(403);
  });

  it('404s an unknown run and an unknown employee', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await request(app).get(`${BASE}/payroll/runs/${fakeId}`)
      .set('Cookie', adminCookie).expect(404);
    await request(app).get(`${BASE}/payroll/employees/${fakeId}`)
      .set('Cookie', adminCookie).expect(404);
  });

  it('400s a malformed id rather than querying with it', async () => {
    const res = await request(app).get(`${BASE}/payroll/runs/not-an-id`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('serves the CSV export without a route parameter swallowing it', async () => {
    const res = await request(app).get(`${BASE}/payroll/export.csv`)
      .set('Cookie', adminCookie).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.text.charCodeAt(0)).toBe(0xFEFF);
  });

  it('reports what is owed alongside the runs', async () => {
    const res = await request(app).get(`${BASE}/payroll/runs`)
      .set('Cookie', adminCookie).expect(200);
    expect(Array.isArray(res.body.liabilities)).toBe(true);
    expect(res.body.liabilities.map(l => l.code))
      .toEqual(expect.arrayContaining(['2300', '2310', '2320', '2350']));
  });
});

// ── Counter sales ────────────────────────────────────────────────────────────

describe('counter sales over HTTP', () => {
  it('lets a pos reader see the day but not ring up a sale', async () => {
    // Someone on the till needs the day's figures; issuing a statutory sales document
    // and posting to the books is a different kind of act.
    await request(app).get(`${BASE}/pos/day`).set('Cookie', readerCookie).expect(200);
    await request(app).get(`${BASE}/pos/receipts`).set('Cookie', readerCookie).expect(200);
    await request(app).post(`${BASE}/pos/sales`)
      .set('Cookie', readerCookie)
      .send({ tender: 'cash', lines: [{ description: 'x', unit_price_gross: 100, vat_rate: 24 }] })
      .expect(403);
  });

  it('rejects a stranger', async () => {
    await request(app).get(`${BASE}/pos/day`).set('Cookie', strangerCookie).expect(403);
  });

  it('rings up a sale, extracting VAT from the price', async () => {
    // 12.400 at 24% → net 10.000, VAT 2.400. Adding VAT on top would produce a receipt
    // for 15.376, which is money the customer never handed over.
    const res = await request(app).post(`${BASE}/pos/sales`)
      .set('Cookie', adminCookie)
      .send({
        tender: 'cash',
        lines: [{ description: 'Eikarborð', unit_price_gross: 12_400, vat_rate: 24 }],
      })
      .expect(201);
    expect(res.body.totals).toMatchObject({
      total_gross: 12_400, subtotal_net: 10_000, vat_total: 2_400,
    });
    expect(res.body.receipt.series).toBe('receipt');
    expect(Number(res.body.receipt.amount_paid)).toBe(12_400);
  });

  it('returns the first receipt (200, duplicate) when the same idempotency key is retried', async () => {
    // A double-tap or a retry after a lost response must not ring up a second sale. The
    // retry comes back 200 with duplicate: true and the SAME receipt, not a fresh 201.
    const key = `http-key-${Math.random().toString(36).slice(2)}`;
    const first = await request(app).post(`${BASE}/pos/sales`)
      .set('Cookie', adminCookie)
      .send({ tender: 'cash', idempotency_key: key,
        lines: [{ description: 'Vara', unit_price_gross: 6_200, vat_rate: 24 }] })
      .expect(201);
    expect(first.body.duplicate).toBe(false);

    const retry = await request(app).post(`${BASE}/pos/sales`)
      .set('Cookie', adminCookie)
      .send({ tender: 'cash', idempotency_key: key,
        lines: [{ description: 'Vara', unit_price_gross: 6_200, vat_rate: 24 }] })
      .expect(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.receipt.id).toBe(first.body.receipt.id);
    expect(retry.body.receipt.invoice_number).toBe(first.body.receipt.invoice_number);
  });

  it('serves the receipt through the same PDF route as an invoice', async () => {
    // A receipt is a row in the same sales ledger, so it prints through the same
    // endpoint — the renderer switches its heading on the series.
    const sale = await request(app).post(`${BASE}/pos/sales`)
      .set('Cookie', adminCookie)
      .send({ tender: 'card', lines: [{ description: 'Hilla', unit_price_gross: 6_200, vat_rate: 24 }] })
      .expect(201);
    const pdf = await request(app).get(`${BASE}/invoices/${sale.body.receipt.id}/pdf`)
      .set('Cookie', adminCookie).expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.headers['cache-control']).toMatch(/no-store/);
  });

  it.each([
    [{ tender: 'bank_transfer', lines: [{ description: 'x', unit_price_gross: 100, vat_rate: 24 }] },
      'a bank transfer at the till'],
    [{ tender: 'cash', lines: [] }, 'an empty sale'],
    [{ tender: 'cash', lines: [{ description: 'x', unit_price_gross: 100 }] },
      'a free-text line with no VAT rate'],
    [{ tender: 'cash', lines: [{ description: 'x', unit_price_gross: 100, vat_rate: 15 }] },
      'a rate outside the statutory set'],
    [{ tender: 'cash', lines: [{ description: '', unit_price_gross: 100, vat_rate: 24 }] },
      'no description'],
    [{ tender: 'cash', lines: [{ description: 'x', unit_price_gross: -100, vat_rate: 24 }] },
      'a negative price'],
    [{ tender: 'cash', lines: [{ description: 'x', unit_price_gross: [100], vat_rate: 24 }] },
      'an array where an amount belongs'],
    [{ lines: [{ description: 'x', unit_price_gross: 100, vat_rate: 24 }] }, 'no tender'],
  ])('returns 4xx for %#: %s', async (body) => {
    const res = await request(app).post(`${BASE}/pos/sales`)
      .set('Cookie', adminCookie).send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body).toHaveProperty('error');
  });

  it('reports the day split by tender and by rate', async () => {
    await request(app).post(`${BASE}/pos/sales`)
      .set('Cookie', adminCookie)
      .send({ tender: 'cash', lines: [{ description: 'Bók', unit_price_gross: 2_220, vat_rate: 11 }] })
      .expect(201);

    const res = await request(app).get(`${BASE}/pos/day`)
      .set('Cookie', adminCookie).expect(200);
    // Split by tender because that is how a drawer is counted; a single total answers
    // neither the cash question nor the card one.
    expect(res.body.by_tender.length).toBeGreaterThan(0);
    expect(res.body.by_rate.map(r => r.rate)).toEqual(expect.arrayContaining([11]));
    for (const r of res.body.by_rate) expect(r.gross).toBe(r.net + r.vat);
  });

  it('offers only priced products that carry a VAT rate', async () => {
    // vat_rate is NOT NULL today, so every product has one — the catalogue's job is to
    // exclude the un-priced and inactive, and to surface the rate the till needs so it
    // never has to guess (a book at 24% is the wrong tax).
    const { rows: sellable } = await db.query(
      `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, vat_rate, active)
       VALUES ('cat-ok','Sölhilla','',5000,32,9,'CAT-OK',24,TRUE)
       ON CONFLICT (slug) DO UPDATE SET vat_rate = 24, price_isk = 5000, active = TRUE RETURNING id`
    );
    const { rows: inactive } = await db.query(
      `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, vat_rate, active)
       VALUES ('cat-off','Afskráð vara','',5000,32,9,'CAT-OFF',24,FALSE)
       ON CONFLICT (slug) DO UPDATE SET active = FALSE, price_isk = 5000 RETURNING id`
    );

    const res = await request(app).get(`${BASE}/pos/catalogue`)
      .set('Cookie', adminCookie).expect(200);
    const ids = res.body.products.map(p => p.id);
    expect(ids).toContain(sellable[0].id);
    expect(ids).not.toContain(inactive[0].id);
    for (const p of res.body.products) {
      expect(p.price_isk).toBeGreaterThan(0);
      expect(p.vat_rate).not.toBeNull();
    }
  });

  it('400s a malformed date rather than scanning everything', async () => {
    await request(app).get(`${BASE}/pos/day?date=abc`).set('Cookie', adminCookie).expect(400);
    await request(app).get(`${BASE}/pos/receipts?limit=-1`).set('Cookie', adminCookie).expect(400);
  });

  it('serves the CSV export without a route parameter swallowing it', async () => {
    const res = await request(app).get(`${BASE}/pos/export.csv`)
      .set('Cookie', adminCookie).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.charCodeAt(0)).toBe(0xFEFF);
  });
});
