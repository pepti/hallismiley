// The order back-fill.
//
// The shop predates the books, so there are paid orders with no invoice and no ledger
// entry. This script issues them. What matters about it is not the happy path but the
// guards: it consumes numbers from a statutory series and posts entries that are
// append-only afterwards, so a wrong run is not something a rollback undoes.
const db = require('../../server/config/database');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const backfill = require('../../server/scripts/books-backfill-orders');
const invoices = require('../../server/services/bookkeeping/invoiceService');
const Setting = require('../../server/models/Setting');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

let adminId;
let productId;
const VALID_KENNITALA = '1203894599';

// Its own year again — 2017 is unclaimed (2018 POS, 2019 reports, 2020 payroll,
// 2021-2025 VSK, 2026 seed).
const PAID_DAY = '2017-04-10';

async function paidOrder(amount, paidAt, suffix) {
  const { rows } = await db.query(
    `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
       payment_status, shipping_method, shipping_address, guest_email, guest_name, paid_at)
     VALUES ($1,'ISK',$2,0,$2,'paid','paid','local_pickup',$3::jsonb,
             'bf@example.is','Backfill Buyer',$4::timestamptz)
     RETURNING id`,
    [`HP-BF-${suffix}`, amount,
      JSON.stringify({ name: 'Backfill Buyer', line1: 'Gata 1', postal: '101', city: 'Reykjavík', country_code: 'IS' }),
      paidAt]
  );
  await db.query(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot,
       product_price_snapshot, quantity, currency)
     VALUES ($1,$2,'Eikarborð',$3,1,'ISK')`,
    [rows[0].id, productId, amount]
  );
  return rows[0].id;
}

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
  const { rows } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, vat_rate)
     VALUES ('bf-bord','Eikarborð','',12400,80,99,'BF-1',24)
     ON CONFLICT (slug) DO UPDATE SET vat_rate = 24 RETURNING id`
  );
  productId = rows[0].id;
  await Setting.updateBookkeepingSettings({
    seller_name: 'Smiley Software ehf.',
    seller_kennitala: VALID_KENNITALA,
    seller_vat_number: '148820',
    payment_terms_days: 14,
  });
  await ledger.withTransaction(c => ledger.ensureFiscalPeriod(c, PAID_DAY));
});

afterAll(async () => { await db.pool.end(); });

describe('argument parsing', () => {
  it('defaults to a dry run', () => {
    // The default has to be safe: the alternative is a mistyped command consuming a
    // hundred invoice numbers that cannot be rewound.
    expect(backfill.parseArgs(['node', 's'])).toMatchObject({ commit: false, as: null });
  });

  it('refuses --commit without naming a person', () => {
    // Reglugerð 505/2013 gr. 8 wants an identifiable person behind every entry, and "the
    // script" is not one.
    expect(() => backfill.parseArgs(['node', 's', '--commit']))
      .toThrow(/--as=USERNAME is required/);
    expect(backfill.parseArgs(['node', 's', '--commit', '--as=halli']).as).toBe('halli');
  });

  it.each([
    [['--limit=0'], 'a zero limit'],
    [['--limit=abc'], 'a non-numeric limit'],
    [['--from=abc'], 'an unparseable date'],
    [['--from=2026-08-01', '--to=2026-01-01'], 'a reversed range'],
    [['--nope'], 'an unknown flag'],
  ])('refuses %#: %s', (extra) => {
    expect(() => backfill.parseArgs(['node', 's', ...extra])).toThrow();
  });
});

describe('finding candidates', () => {
  it('finds a paid order with no invoice', async () => {
    const id = await paidOrder(12_400, PAID_DAY, `a${Math.random().toString(36).slice(2, 7)}`);
    const found = await backfill.findCandidates({ from: PAID_DAY, to: PAID_DAY });
    expect(found.map(o => o.id)).toContain(id);
  });

  it('stops finding it once it has been invoiced', async () => {
    // The idempotency that makes a stopped run safe to re-run.
    const id = await paidOrder(12_400, PAID_DAY, `b${Math.random().toString(36).slice(2, 7)}`);
    await ledger.withTransaction(c => invoices.createFromOrder(c, id, { createdBy: adminId }));
    const found = await backfill.findCandidates({ from: PAID_DAY, to: PAID_DAY });
    expect(found.map(o => o.id)).not.toContain(id);
  });

  it('ignores an unpaid order', async () => {
    // An unpaid order is not a sale yet. Invoicing it would create revenue and output VAT
    // for money nobody has agreed to pay.
    const { rows } = await db.query(
      `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
         payment_status, shipping_method, shipping_address, guest_email, guest_name)
       VALUES ($1,'ISK',5000,0,5000,'pending','pending','local_pickup',$2::jsonb,
               'x@example.is','Unpaid')
       RETURNING id`,
      [`HP-BF-unpaid-${Math.random().toString(36).slice(2, 7)}`,
        JSON.stringify({ name: 'Unpaid', line1: 'G', postal: '101', city: 'R', country_code: 'IS' })]
    );
    const found = await backfill.findCandidates({});
    expect(found.map(o => o.id)).not.toContain(rows[0].id);
  });

  it('returns them oldest first', async () => {
    // Invoice numbers come from a gapless counter, so issuing in payment order keeps the
    // series running in the same direction as time. Newest-first would leave 1050 dated
    // before 1049 — legal, and reads as a mistake to anyone auditing it.
    const suffix = Math.random().toString(36).slice(2, 7);
    await paidOrder(1_000, `${PAID_DAY}T10:00:00Z`, `c2-${suffix}`);
    await paidOrder(2_000, '2017-04-08T10:00:00Z', `c1-${suffix}`);
    await ledger.withTransaction(c => ledger.ensureFiscalPeriod(c, '2017-04-08'));

    const found = await backfill.findCandidates({ from: '2017-04-01', to: '2017-04-30' });
    const dates = found.map(o => new Date(o.paid_at).getTime());
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });

  it('honours the date window and the limit', async () => {
    const suffix = Math.random().toString(36).slice(2, 7);
    await paidOrder(3_000, '2017-04-20T10:00:00Z', `d-${suffix}`);
    await ledger.withTransaction(c => ledger.ensureFiscalPeriod(c, '2017-04-20'));

    const windowed = await backfill.findCandidates({ from: '2017-04-20', to: '2017-04-20' });
    expect(windowed.length).toBeGreaterThan(0);
    for (const o of windowed) {
      expect(new Date(o.paid_at).toISOString().slice(0, 10)).toBe('2017-04-20');
    }
    const limited = await backfill.findCandidates({ limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it('includes an order paid at the very end of the "to" day', async () => {
    // The window is a half-open range on the day AFTER `to`, because `paid_at` is a
    // timestamp: comparing it to `to::date` directly would drop everything paid after
    // midnight on the last day of the range.
    const suffix = Math.random().toString(36).slice(2, 7);
    const id = await paidOrder(4_000, '2017-04-22T23:59:59Z', `e-${suffix}`);
    await ledger.withTransaction(c => ledger.ensureFiscalPeriod(c, '2017-04-22'));
    const found = await backfill.findCandidates({ from: '2017-04-22', to: '2017-04-22' });
    expect(found.map(o => o.id)).toContain(id);
  });
});
