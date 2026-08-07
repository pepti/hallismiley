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
  const views = ['books', 'invoices', 'ar', 'vat', 'ledger'];
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
});
