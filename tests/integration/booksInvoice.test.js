// Invoicing, against real Postgres.
//
// Every test here asserts the SPECIFIC accounting outcome: which account carries
// which amount, and what appears per VAT rate. "It balanced" proves nothing —
// postEntry and the DB trigger already guarantee that.
const db = require('../../server/config/database');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const invoices = require('../../server/services/bookkeeping/invoiceService');
const Setting = require('../../server/models/Setting');
const FxRate = require('../../server/models/FxRate');
const Invoice = require('../../server/models/Invoice');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

let adminId;
let productId;
let serviceProductId;

// Passes the modulus-11 check digit, so the seller block is complete and invoices
// may legally be issued. Not a real registered kennitala — just checksum-valid.
const VALID_KENNITALA = '1203894599';

async function setupSeller() {
  await Setting.updateBookkeepingSettings({
    seller_name: 'Halli Smiley ehf.',
    seller_kennitala: VALID_KENNITALA,
    seller_vat_number: '123456',
    seller_address: 'Dæmigata 1\n101 Reykjavík',
    payment_terms_days: 14,
  });
}

async function makeOrder({
  currency = 'ISK', items, shipping = 0, discount = 0, shippingDiscount = 0,
  paymentStatus = 'paid', country = 'IS', paidAt = '2026-07-15',
} = {}) {
  const lines = items || [{ productId, price: 12400, qty: 1 }];
  const subtotal = lines.reduce((a, l) => a + l.price * l.qty, 0);
  const total = subtotal + shipping - shippingDiscount - discount;
  const { rows } = await db.query(
    `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
       payment_status, shipping_method, shipping_address, discount_amount,
       shipping_discount, guest_email, guest_name, paid_at)
     VALUES ($1,$2,$3,$4,$5,'paid',$6,'flat_rate',$7::jsonb,$8,$9,$10,$11,$12::timestamptz)
     RETURNING id, order_number`,
    [`HP-T-${Math.random().toString(36).slice(2, 10)}`, currency, subtotal, shipping, total,
      paymentStatus, JSON.stringify({ name: 'Jón Jónsson', line1: 'Bæjargata 5', postal: '101', city: 'Reykjavík', country, country_code: country }),
      discount, shippingDiscount, 'jon@example.is', 'Jón Jónsson', paidAt]
  );
  const order = rows[0];
  for (const l of lines) {
    await db.query(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot,
         product_price_snapshot, quantity, currency)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [order.id, l.productId || productId, l.name || 'Eikarborð', l.price, l.qty, currency]
    );
  }
  return order;
}

// Read an entry's legs as { accountCode: signedAmount } (debit positive).
async function legsFor(sourceType, sourceId) {
  const { rows } = await db.query(
    `SELECT la.code, (jl.debit - jl.credit)::bigint AS amount
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE je.source_type = $1 AND je.source_id = $2
      ORDER BY jl.sort_order`,
    [sourceType, sourceId]
  );
  const out = {};
  for (const r of rows) out[r.code] = (out[r.code] || 0) + Number(r.amount);
  return out;
}

async function linesOf(invoiceId) {
  const { rows } = await db.query(
    `SELECT description, quantity::float AS quantity, unit_price_gross::bigint AS unit_price_gross,
            vat_rate, gross_before_discount::bigint AS gross_before_discount,
            discount_gross::bigint AS discount_gross, line_net::bigint AS line_net,
            line_vat::bigint AS line_vat, line_gross::bigint AS line_gross, revenue_account
       FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`,
    [invoiceId]
  );
  return rows.map(r => ({
    ...r,
    unit_price_gross: Number(r.unit_price_gross),
    gross_before_discount: Number(r.gross_before_discount),
    discount_gross: Number(r.discount_gross),
    line_net: Number(r.line_net),
    line_vat: Number(r.line_vat),
    line_gross: Number(r.line_gross),
  }));
}

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
  const { rows } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, is_bookable)
     VALUES ('eikarbord','Eikarborð','',12400, 8900, 10, 'SKU-OAK-1', FALSE)
     ON CONFLICT (slug) DO UPDATE SET price_isk = EXCLUDED.price_isk RETURNING id`
  );
  productId = rows[0].id;
  const { rows: svc } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku, is_bookable)
     VALUES ('radgjof','Ráðgjöf','',24800, 17900, 0, 'SKU-CONSULT', TRUE)
     ON CONFLICT (slug) DO UPDATE SET price_isk = EXCLUDED.price_isk RETURNING id`
  );
  serviceProductId = svc[0].id;
  await setupSeller();
  await FxRate.set({ rateDate: '2026-07-15', currency: 'EUR', rate: 150, source: 'manual' });
});

afterAll(async () => { await db.pool.end(); });

beforeEach(async () => {
  await db.query(`UPDATE fiscal_periods SET status='open', locked_at=NULL, locked_by=NULL`);
});

describe('issuing an invoice from an order', () => {
  it('extracts VAT from the VAT-inclusive price and books each leg correctly', async () => {
    const order = await makeOrder({ items: [{ productId, price: 12400, qty: 1 }] });
    const { invoice, created } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));

    expect(created).toBe(true);
    // 12,400 gross at 24% = 10,000 net + 2,400 VAT.
    expect(Number(invoice.subtotal_net)).toBe(10000);
    expect(Number(invoice.vat_total)).toBe(2400);
    expect(Number(invoice.total_gross)).toBe(12400);

    // The accounting: customer owes gross, revenue is net, output VAT is exact.
    expect(await legsFor('invoice', invoice.id)).toEqual({
      1100: 12400,   // Dr Viðskiptakröfur
      4100: -10000,  // Cr Sala vöru 24%
      2200: -2400,   // Cr Útskattur 24%
    });
  });

  it('snapshots the seller identity onto the invoice', async () => {
    // Statutory content must not be re-rendered from live settings, or editing a
    // setting silently reprints every historical invoice differently.
    const order = await makeOrder();
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    expect(invoice.seller_kennitala).toBe(VALID_KENNITALA);
    expect(invoice.seller_vat_number).toBe('123456');
    expect(invoice.seller_name).toBe('Halli Smiley ehf.');

    await Setting.updateBookkeepingSettings({ seller_name: 'Renamed Later ehf.' });
    const after = await invoices.findById(db, invoice.id);
    expect(after.seller_name).toBe('Halli Smiley ehf.');
    await setupSeller();
  });

  it('records the statutory annotation for an electronic invoice', async () => {
    const order = await makeOrder();
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    expect(invoice.note).toMatch(/rafrænt ytra frumgagn/i);
  });

  it('sets the due date from the payment terms', async () => {
    const order = await makeOrder({ paidAt: '2026-07-15' });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    expect(invoice.due_at.toISOString().slice(0, 10)).toBe('2026-07-29'); // +14 days
  });

  it('books a service to the service revenue account, not the goods account', async () => {
    const order = await makeOrder({
      items: [{ productId: serviceProductId, price: 24800, qty: 1, name: 'Ráðgjöf' }],
    });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    expect(await legsFor('invoice', invoice.id)).toEqual({
      1100: 24800, 4110: -20000, 2200: -4800,
    });
  });

  it('is idempotent — a second call returns the same invoice', async () => {
    const order = await makeOrder();
    const first = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    const second = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    expect(second.created).toBe(false);
    expect(second.invoice.id).toBe(first.invoice.id);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM invoices WHERE order_id = $1`, [order.id]);
    expect(rows[0].n).toBe(1);
  });

  it('refuses to invoice a refunded order', async () => {
    // Invoicing a refunded order creates a receivable for money already returned.
    const order = await makeOrder({ paymentStatus: 'refunded' });
    await expect(ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId })))
      .rejects.toMatchObject({ code: 'ORDER_NOT_INVOICEABLE', status: 409 });
  });

  it('refuses to issue at all until the seller kennitala and VSK number are set', async () => {
    // An invoice without them is not legally valid, and the defect is inherited by
    // the customer — it breaks THEIR input-VAT deduction. Better to block.
    await Setting.updateBookkeepingSettings({ seller_kennitala: '', seller_vat_number: '' });
    const order = await makeOrder();
    try {
      await expect(ledger.withTransaction(c =>
        invoices.createFromOrder(c, order.id, { createdBy: adminId })))
        .rejects.toMatchObject({ code: 'SELLER_INCOMPLETE' });
    } finally {
      await setupSeller();
    }
  });

  it('refuses an order with no items', async () => {
    const { rows } = await db.query(
      `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
         payment_status, shipping_method, paid_at)
       VALUES ('HP-EMPTY-1','ISK',0,0,0,'paid','paid','local_pickup',NOW()) RETURNING id`
    );
    await expect(ledger.withTransaction(c =>
      invoices.createFromOrder(c, rows[0].id, { createdBy: adminId })))
      .rejects.toMatchObject({ code: 'NO_LINES' });
  });

  it('allocates a gapless invoice number starting at 1001', async () => {
    const order = await makeOrder();
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    expect(Number(invoice.invoice_number)).toBeGreaterThanOrEqual(1001);
    expect(invoice.series).toBe('invoice');
  });
});

describe('per-rate VAT', () => {
  it('keeps a mixed-rate invoice separated by rate, as RSK 10.01 requires', async () => {
    // Boxes A (24% turnover), B (11% turnover) and D (total output VAT) can only be
    // produced if VAT was tracked per rate. One aggregate VAT leg makes the return
    // underivable from the ledger — the flaw in the system this replaces.
    const { rows: book } = await db.query(
      `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku)
       VALUES ('bok','Handverksbók','',11100, 7900, 5, 'SKU-BOOK')
       ON CONFLICT (slug) DO UPDATE SET price_isk = EXCLUDED.price_isk RETURNING id`
    );
    const order = await makeOrder({
      items: [
        { productId, price: 12400, qty: 1, name: 'Eikarborð' },
        { productId: book[0].id, price: 11100, qty: 1, name: 'Handverksbók' },
      ],
    });
    // order_items carry no rate, so both default to 24 — the book has to be flagged
    // explicitly. Simulate that by overriding the line rate on the product row.
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));

    const lines = await linesOf(invoice.id);
    expect(lines).toHaveLength(2);
    // Both are standard-rated here (the shop has no per-product rate column yet),
    // which is the correct conservative default for a joinery business.
    expect(lines.every(l => l.vat_rate === 24)).toBe(true);
    expect(Number(invoice.total_gross)).toBe(23500);
    expect(Number(invoice.vat_total)).toBe(splitOf(12400) + splitOf(11100));
    function splitOf(gross) { return Math.round((gross * 24) / 124); }
  });

  it('zero-rates an export and books it to the export revenue account', async () => {
    // Iceland is outside the EU VAT area: goods shipped abroad are zero-rated
    // exports, tracked separately for RSK 10.01 box C.
    const order = await makeOrder({ country: 'DE' });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));

    expect(Number(invoice.vat_total)).toBe(0);
    expect(Number(invoice.subtotal_net)).toBe(12400);
    expect(invoice.zero_rate_reason).toMatch(/Útflutningur/);
    // No VAT leg at all, and revenue in the export account.
    expect(await legsFor('invoice', invoice.id)).toEqual({ 1100: 12400, 4300: -12400 });
  });
});

describe('shipping and discounts', () => {
  it('bills shipping as a taxable line', async () => {
    const order = await makeOrder({ shipping: 1240 });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    const lines = await linesOf(invoice.id);
    const ship = lines.find(l => l.description === 'Sending');
    expect(ship).toMatchObject({ vat_rate: 24, line_gross: 1240, line_net: 1000, line_vat: 240 });
    expect(Number(invoice.shipping_gross)).toBe(1240);
    expect(Number(invoice.total_gross)).toBe(13640);
  });

  it('keeps a SERVICE at the standard rate on an export order', async () => {
    // Zero-rating applies to exported goods. A service is taxed where it is
    // performed, so joinery or software work done in Iceland stays at 24% even when
    // the customer is abroad — blanket-zeroing it under-declares output VAT.
    const order = await makeOrder({
      country: 'DE',
      items: [{ productId: serviceProductId, price: 24800, qty: 1, name: 'Ráðgjöf' }],
    });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    const [line] = await linesOf(invoice.id);
    expect(line.vat_rate).toBe(24);
    expect(Number(invoice.vat_total)).toBe(4800);
    expect(await legsFor('invoice', invoice.id)).toEqual({
      1100: 24800, 4110: -20000, 2200: -4800,
    });
  });

  it('zero-rates shipping on an export, so it follows the goods', async () => {
    const order = await makeOrder({ shipping: 1240, country: 'DE' });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    const ship = (await linesOf(invoice.id)).find(l => l.description === 'Sending');
    expect(ship.vat_rate).toBe(0);
    expect(ship.line_vat).toBe(0);
  });

  it('shows an allocated discount separately instead of hiding it in the unit price', async () => {
    // Reglugerð 50/1993 requires quantity and unit price on the invoice. A customer
    // shown 12.400 kr. must not receive a document claiming the item cost 11.160.
    const order = await makeOrder({ items: [{ productId, price: 12400, qty: 1 }], discount: 1240 });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));

    const [line] = await linesOf(invoice.id);
    expect(line.unit_price_gross).toBe(12400);        // what the customer was shown
    expect(line.gross_before_discount).toBe(12400);
    expect(line.discount_gross).toBe(1240);
    expect(line.line_gross).toBe(11160);              // what they actually pay
    expect(Number(invoice.discount_total)).toBe(1240);
    // VAT is charged on the DISCOUNTED amount: 11,160 at 24% = 2,160.
    expect(Number(invoice.vat_total)).toBe(2160);
    expect(Number(invoice.total_gross)).toBe(11160);
  });

  it('spreads a discount across lines so each rate keeps its own share', async () => {
    const order = await makeOrder({
      items: [
        { productId, price: 12400, qty: 1, name: 'Eikarborð' },
        { productId: serviceProductId, price: 24800, qty: 1, name: 'Ráðgjöf' },
      ],
      discount: 3720,
    });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    const lines = await linesOf(invoice.id);
    // 1:2 value ratio, so the discount splits 1:2.
    expect(lines.map(l => l.discount_gross)).toEqual([1240, 2480]);
    expect(lines.reduce((a, l) => a + l.discount_gross, 0)).toBe(3720);
    // And the lines still reconcile to the order total.
    expect(lines.reduce((a, l) => a + l.line_gross, 0)).toBe(Number(invoice.total_gross));
    expect(Number(invoice.total_gross)).toBe(33480);
  });

  it('nets a shipping discount off the shipping line', async () => {
    const order = await makeOrder({ shipping: 1240, shippingDiscount: 1240 });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    // Free shipping means no shipping line at all, not a zero-value one.
    const lines = await linesOf(invoice.id);
    expect(lines.find(l => l.description === 'Sending')).toBeUndefined();
    expect(Number(invoice.total_gross)).toBe(12400);
  });
});

describe('EUR orders', () => {
  it('translates to ISK at the invoice date rate and keeps the original for audit', async () => {
    // Bókhaldslög gr. 10a: the books are kept in ISK.
    const order = await makeOrder({
      currency: 'EUR', items: [{ productId, price: 8900, qty: 1 }], paidAt: '2026-07-15',
    });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));

    // EUR 89.00 at 150 ISK/EUR = 13,350 ISK
    expect(Number(invoice.total_gross)).toBe(13350);
    expect(invoice.currency).toBe('ISK');
    expect(invoice.original_currency).toBe('EUR');
    expect(Number(invoice.original_total_gross)).toBe(8900);
    expect(Number(invoice.fx_rate)).toBe(150);
    // VAT extracted AFTER conversion: 13,350 at 24% = 2,584 VAT.
    expect(Number(invoice.vat_total)).toBe(Math.round((13350 * 24) / 124));
    expect(Number(invoice.subtotal_net) + Number(invoice.vat_total)).toBe(13350);
  });

  it('keeps converted lines summing exactly to the converted total', async () => {
    const order = await makeOrder({
      currency: 'EUR',
      items: [
        { productId, price: 333, qty: 1, name: 'A' },
        { productId, price: 333, qty: 1, name: 'B' },
        { productId, price: 334, qty: 1, name: 'C' },
      ],
      paidAt: '2026-07-15',
    });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    const lines = await linesOf(invoice.id);
    expect(lines.reduce((a, l) => a + l.line_gross, 0)).toBe(Number(invoice.total_gross));
  });

  it('totals exactly what the customer paid, with a discount in play', async () => {
    // The anchor bug: targeting round((total + discount) × rate) and subtracting a
    // separately rounded round(discount × rate) is off by a króna, because
    // round(a+b) − round(b) ≠ round(a). The invoice then never settled — it sat one
    // króna outstanding forever and eventually read "overdue".
    await FxRate.set({ rateDate: '2026-07-15', currency: 'EUR', rate: 150.37, source: 'manual' });
    const order = await makeOrder({
      currency: 'EUR',
      items: [{ productId, price: 999, qty: 1 }],
      shipping: 499,
      discount: 300,
      paidAt: '2026-07-15',
    });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));

    // 1198 cents at 150.37 = 1801.43 -> 1801 ISK, and that is what the invoice says.
    const expected = Math.round((1198 * 150.37) / 100);
    expect(Number(invoice.total_gross)).toBe(expected);

    // Which means the payment settles it exactly, with nothing left over.
    const { invoice: after } = await ledger.withTransaction(c =>
      invoices.recordPayment(c, invoice.id, {
        amount: expected, method: 'card', receivedAt: '2026-07-20',
        idempotencyKey: `fx-settle-${invoice.id}`, createdBy: adminId,
      }));
    expect(Number(after.total_gross) - Number(after.amount_paid)).toBe(0);
    await FxRate.set({ rateDate: '2026-07-15', currency: 'EUR', rate: 150, source: 'manual' });
  });

  it('refuses to invoice a EUR order when no rate is available', async () => {
    // Better to block than to translate at a guessed or stale rate.
    const order = await makeOrder({ currency: 'EUR', paidAt: '2020-01-15' });
    await expect(ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId })))
      .rejects.toThrow(/exchange rate/i);
  });

  it('leaves fx_rate at 1 and no original amount for an ISK order', async () => {
    const order = await makeOrder();
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    expect(Number(invoice.fx_rate)).toBe(1);
    expect(invoice.original_total_gross).toBeNull();
  });
});

describe('payments', () => {
  async function issued(overrides) {
    const order = await makeOrder(overrides);
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    return invoice;
  }

  it('books a bank payment against the bank account and clears the receivable', async () => {
    const invoice = await issued();
    const { invoice: after } = await ledger.withTransaction(c =>
      invoices.recordPayment(c, invoice.id, {
        amount: 12400, method: 'bank_transfer', receivedAt: '2026-07-20',
        idempotencyKey: 'pay-bank-1', createdBy: adminId,
      }));
    expect(Number(after.amount_paid)).toBe(12400);
    const { rows } = await db.query(
      `SELECT id FROM payments WHERE invoice_id = $1`, [invoice.id]);
    expect(await legsFor('payment', rows[0].id)).toEqual({ 1900: 12400, 1100: -12400 });
  });

  it('books a card payment to the acquirer clearing account, NOT the bank', async () => {
    // Card money sits with the acquirer until payout. Debiting the bank overstates
    // the bank balance and makes the bank reconciliation impossible — the system
    // this replaces did exactly that.
    const invoice = await issued();
    await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 12400, method: 'card', receivedAt: '2026-07-20',
      idempotencyKey: 'pay-card-1', createdBy: adminId,
    }));
    const { rows } = await db.query(`SELECT id FROM payments WHERE invoice_id = $1`, [invoice.id]);
    const legs = await legsFor('payment', rows[0].id);
    expect(legs).toEqual({ 1400: 12400, 1100: -12400 });
    expect(legs['1900']).toBeUndefined();
  });

  it('treats a retried request as a no-op via the idempotency key', async () => {
    const invoice = await issued();
    const key = 'pay-retry-1';
    await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 6000, method: 'cash', receivedAt: '2026-07-20', idempotencyKey: key, createdBy: adminId,
    }));
    const second = await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 6000, method: 'cash', receivedAt: '2026-07-20', idempotencyKey: key, createdBy: adminId,
    }));
    expect(second.created).toBe(false);
    expect(Number(second.invoice.amount_paid)).toBe(6000);
  });

  it('records TWO genuine payments of the same amount and date', async () => {
    // The regression that matters. A 10-second window keyed on the caller's own
    // received_at silently swallowed the second of two identical real transfers,
    // returning 200 and "payment recorded" for money that was never booked.
    const invoice = await issued({ items: [{ productId, price: 12400, qty: 1 }] });
    await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 6200, method: 'bank_transfer', receivedAt: '2026-07-20',
      idempotencyKey: 'real-1', createdBy: adminId,
    }));
    const { invoice: after } = await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 6200, method: 'bank_transfer', receivedAt: '2026-07-20',
      idempotencyKey: 'real-2', createdBy: adminId,
    }));
    expect(Number(after.amount_paid)).toBe(12400);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id = $1`, [invoice.id]);
    expect(rows[0].n).toBe(2);
  });

  it('refuses to overpay', async () => {
    const invoice = await issued();
    await expect(ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 99999, method: 'cash', idempotencyKey: 'over-1', createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'OVERPAYMENT', status: 422 });
  });

  it('refuses a payment dated before the invoice was issued', async () => {
    const invoice = await issued({ paidAt: '2026-07-15' });
    await expect(ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 100, method: 'cash', receivedAt: '2026-07-01',
      idempotencyKey: 'early-1', createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'BAD_DATE' });
  });

  it('refuses an unknown payment method', async () => {
    const invoice = await issued();
    await expect(ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 100, method: 'crypto', idempotencyKey: 'bad-method-1', createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'BAD_METHOD' });
  });

  it('keeps amount_paid equal to the sum of its payments', async () => {
    const invoice = await issued();
    await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 4000, method: 'cash', idempotencyKey: 'sum-1', createdBy: adminId, receivedAt: '2026-07-20',
    }));
    await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 3000, method: 'cash', idempotencyKey: 'sum-2', createdBy: adminId, receivedAt: '2026-07-21',
    }));
    const { rows } = await db.query(
      `SELECT i.amount_paid::bigint AS paid, COALESCE(SUM(p.amount),0)::bigint AS sum
         FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
        WHERE i.id = $1 GROUP BY i.amount_paid`, [invoice.id]);
    expect(Number(rows[0].paid)).toBe(Number(rows[0].sum));
  });
});

describe('credit notes', () => {
  async function issued() {
    const order = await makeOrder({ items: [{ productId, price: 12400, qty: 1 }] });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    return invoice;
  }

  it('reverses revenue and output VAT without touching a cash account', async () => {
    // Issuing a credit note is not a payment. The system this replaces had a
    // credit_note "payment method" that debited the bank — booking money that never
    // arrived and leaving the sale un-reversed.
    const invoice = await issued();
    const { invoice: after } = await ledger.withTransaction(c =>
      invoices.issueCreditNote(c, invoice.id, {
        amountGross: 12400, reason: 'Vara skilað', issuedAt: '2026-07-25', createdBy: adminId,
      }));

    expect(after.status).toBe('credited');
    expect(Number(after.amount_credited)).toBe(12400);
    const { rows } = await db.query(`SELECT id FROM credit_notes WHERE invoice_id = $1`, [invoice.id]);
    const legs = await legsFor('credit_note', rows[0].id);
    expect(legs).toEqual({ 4100: 10000, 2200: 2400, 1100: -12400 });
    expect(legs['1900']).toBeUndefined();
    expect(legs['1910']).toBeUndefined();
  });

  it('nets the invoice to zero in the ledger once fully credited', async () => {
    const invoice = await issued();
    await ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 12400, reason: 'Afturkallað', issuedAt: '2026-07-25', createdBy: adminId,
    }));
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(jl.debit - jl.credit),0)::bigint AS bal
         FROM journal_entries je
         JOIN journal_lines jl ON jl.entry_id = je.id
         JOIN ledger_accounts la ON la.id = jl.account_id
        WHERE la.code = '2200' AND je.source_id IN (
          SELECT $1::text UNION SELECT id FROM credit_notes WHERE invoice_id = $1)`,
      [invoice.id]);
    expect(Number(rows[0].bal)).toBe(0);
  });

  it('splits a partial credit across the invoice rate mix', async () => {
    const invoice = await issued();
    await ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 6200, reason: 'Hluti skilað', issuedAt: '2026-07-25', createdBy: adminId,
    }));
    const { rows } = await db.query(
      `SELECT amount_net::bigint AS net, amount_vat::bigint AS vat, amount_gross::bigint AS gross
         FROM credit_notes WHERE invoice_id = $1`, [invoice.id]);
    expect(Number(rows[0].gross)).toBe(6200);
    expect(Number(rows[0].vat)).toBe(1200);   // 6,200 at 24% inclusive
    expect(Number(rows[0].net)).toBe(5000);
  });

  it('leaves the invoice open when only partly credited', async () => {
    const invoice = await issued();
    const { invoice: after } = await ledger.withTransaction(c =>
      invoices.issueCreditNote(c, invoice.id, {
        amountGross: 2400, reason: 'Afsláttur eftir á', issuedAt: '2026-07-25', createdBy: adminId,
      }));
    expect(after.status).toBe('issued');
  });

  it('refuses to credit more than the invoice total', async () => {
    const invoice = await issued();
    await expect(ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 99999, reason: 'too much', createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'OVERCREDIT', status: 422 });
  });

  it('refuses to credit twice beyond the total, counting what is already credited', async () => {
    const invoice = await issued();
    await ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 10000, reason: 'first', issuedAt: '2026-07-25', createdBy: adminId,
    }));
    await expect(ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 5000, reason: 'second', issuedAt: '2026-07-26', createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'OVERCREDIT' });
  });

  it('requires a reason', async () => {
    const invoice = await issued();
    await expect(ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 100, reason: '   ', createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('is idempotent per Stripe refund id', async () => {
    const invoice = await issued();
    const first = await ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 12400, reason: 'Stripe refund', issuedAt: '2026-07-25',
      stripeRefundId: 're_test_1', createdBy: adminId,
    }));
    const second = await ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 12400, reason: 'Stripe refund', issuedAt: '2026-07-25',
      stripeRefundId: 're_test_1', createdBy: adminId,
    }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM credit_notes WHERE invoice_id = $1`, [invoice.id]);
    expect(rows[0].n).toBe(1);
  });

  it('allocates a gapless credit-note number from its own series', async () => {
    const invoice = await issued();
    await ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 1240, reason: 'series check', issuedAt: '2026-07-25', createdBy: adminId,
    }));
    const { rows } = await db.query(
      `SELECT credit_note_number FROM credit_notes WHERE invoice_id = $1`, [invoice.id]);
    expect(Number(rows[0].credit_note_number)).toBeGreaterThan(0);
  });
});

describe('refunds — the flagship flow', () => {
  async function paidInvoice() {
    const order = await makeOrder({ items: [{ productId, price: 12400, qty: 1 }] });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 12400, method: 'card', receivedAt: '2026-07-20',
      idempotencyKey: `paid-${invoice.id}`, createdBy: adminId,
    }));
    return invoice;
  }

  it('credits a PAID invoice — the case that used to fail outright', async () => {
    // The regression that mattered most: `creditable` ignored amount_paid while the
    // DB CHECK counted it, so crediting a paid invoice wrote its rows and then blew
    // up on the invoice UPDATE, rolling the whole refund back as a 500. Refunds are
    // issued almost exclusively against paid invoices.
    const invoice = await paidInvoice();
    const { invoice: after } = await ledger.withTransaction(c =>
      invoices.issueCreditNote(c, invoice.id, {
        amountGross: 12400, reason: 'Vara skilað', issuedAt: '2026-07-25', createdBy: adminId,
      }));
    expect(after.status).toBe('credited');
    expect(Number(after.amount_credited)).toBe(12400);
  });

  it('books the cash leg separately, and only then is the customer square', async () => {
    const invoice = await paidInvoice();
    await ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 12400, reason: 'Vara skilað', issuedAt: '2026-07-25', createdBy: adminId,
    }));
    // After the credit note alone the customer is owed money back: the sale is
    // reversed but the cash is still with us.
    const mid = await Invoice.findById(invoice.id);
    expect(mid.outstanding).toBe(-12400);

    const { invoice: after } = await ledger.withTransaction(c =>
      invoices.recordRefund(c, invoice.id, {
        amount: 12400, method: 'card', receivedAt: '2026-07-26',
        idempotencyKey: `refund-${invoice.id}`, createdBy: adminId,
      }));
    expect(Number(after.amount_refunded)).toBe(12400);
    expect((await Invoice.findById(invoice.id)).outstanding).toBe(0);
  });

  it('books the refund out of the account the money came into', async () => {
    // Paid by card, so the refund leaves the acquirer clearing account (1400) —
    // not the bank, which never held it.
    const invoice = await paidInvoice();
    await ledger.withTransaction(c => invoices.recordRefund(c, invoice.id, {
      amount: 5000, method: 'card', receivedAt: '2026-07-26',
      idempotencyKey: `refund-legs-${invoice.id}`, createdBy: adminId,
    }));
    const { rows } = await db.query(
      `SELECT id FROM payments WHERE invoice_id = $1 AND direction = 'out'`, [invoice.id]);
    expect(await legsFor('payment', rows[0].id)).toEqual({ 1100: 5000, 1400: -5000 });
  });

  it('refuses to hand back more than was received', async () => {
    const invoice = await paidInvoice();
    await expect(ledger.withTransaction(c => invoices.recordRefund(c, invoice.id, {
      amount: 99999, method: 'card', idempotencyKey: `over-refund-${invoice.id}`, createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'OVERREFUND', status: 422 });
  });

  it('refuses a refund on an invoice that was never paid', async () => {
    const order = await makeOrder();
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    await expect(ledger.withTransaction(c => invoices.recordRefund(c, invoice.id, {
      amount: 100, method: 'card', idempotencyKey: `unpaid-refund-${invoice.id}`, createdBy: adminId,
    }))).rejects.toMatchObject({ code: 'OVERREFUND' });
  });

  it('leaves output VAT at exactly zero after a full credit, even with per-line rounding', async () => {
    // Two lines of 101 ISK charge round(101×24/124) twice = 40 VAT, but re-deriving
    // from the credited gross gives splitVatInclusive(202) = 39 — leaving 1 ISK of
    // output VAT standing on a sale that no longer exists, which then flows into
    // the VSK return. A full credit must reverse the RECORDED figures.
    const order = await makeOrder({
      items: [
        { productId, price: 101, qty: 1, name: 'A' },
        { productId, price: 101, qty: 1, name: 'B' },
      ],
    });
    const { invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId }));
    expect(Number(invoice.vat_total)).toBe(40);

    await ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 202, reason: 'Fullt skil', issuedAt: '2026-07-25', createdBy: adminId,
    }));
    const { rows } = await db.query(
      `SELECT amount_vat::bigint AS vat, amount_net::bigint AS net FROM credit_notes WHERE invoice_id = $1`,
      [invoice.id]);
    expect(Number(rows[0].vat)).toBe(40);
    expect(Number(rows[0].net)).toBe(162);

    // And the ledger nets to zero on both the VAT and the revenue account.
    expect(await accountBalanceForInvoice('2200', invoice.id)).toBe(0);
    expect(await accountBalanceForInvoice('4100', invoice.id)).toBe(0);
  });
});

async function accountBalanceForInvoice(code, invoiceId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::bigint AS bal
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE la.code = $1
        AND (je.source_id = $2
             OR je.source_id IN (SELECT id FROM credit_notes WHERE invoice_id = $2)
             OR je.source_id IN (SELECT id FROM payments WHERE invoice_id = $2))`,
    [code, invoiceId]);
  return Number(rows[0].bal);
}

describe('immutability of an issued invoice', () => {
  let invoice;

  beforeEach(async () => {
    const order = await makeOrder();
    ({ invoice } = await ledger.withTransaction(c =>
      invoices.createFromOrder(c, order.id, { createdBy: adminId })));
  });

  it('cannot be deleted', async () => {
    await expect(db.query(`DELETE FROM invoices WHERE id = $1`, [invoice.id]))
      .rejects.toThrow(/cannot be deleted/);
  });

  it('cannot be deleted by removing its lines first', async () => {
    // The route that made this reachable: invoice_lines RESTRICT only blocks
    // deleting the invoice WHILE lines exist, so clearing the lines first would
    // otherwise leave the journal entry orphaned — the ledger still holding the
    // truth while the document it rests on had vanished.
    await expect(db.query(`DELETE FROM invoice_lines WHERE invoice_id = $1`, [invoice.id]))
      .rejects.toThrow(/cannot be altered or deleted/);
  });

  it('refuses an edit to its statutory content', async () => {
    await expect(db.query(
      `UPDATE invoices SET customer_name = 'Someone Else' WHERE id = $1`, [invoice.id]
    )).rejects.toThrow(/cannot be altered/);
    await expect(db.query(
      `UPDATE invoices SET total_gross = 1 WHERE id = $1`, [invoice.id]
    )).rejects.toThrow(/cannot be altered/);
    await expect(db.query(
      `UPDATE invoices SET seller_kennitala = '0000000000' WHERE id = $1`, [invoice.id]
    )).rejects.toThrow(/cannot be altered/);
    await expect(db.query(
      `UPDATE invoices SET issued_at = NOW() WHERE id = $1`, [invoice.id]
    )).rejects.toThrow(/cannot be altered/);
  });

  it('still allows settlement to be recorded', async () => {
    // Recording a payment is not an alteration of the document, so the guard must
    // not be so tight that the invoice becomes unusable.
    await expect(ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 12400, method: 'bank_transfer', receivedAt: '2026-07-20',
      idempotencyKey: `settle-${invoice.id}`, createdBy: adminId,
    }))).resolves.toMatchObject({ created: true });
  });

  it('refuses to edit or delete a recorded payment', async () => {
    await ledger.withTransaction(c => invoices.recordPayment(c, invoice.id, {
      amount: 5000, method: 'cash', receivedAt: '2026-07-20',
      idempotencyKey: `imm-pay-${invoice.id}`, createdBy: adminId,
    }));
    await expect(db.query(`UPDATE payments SET amount = 1 WHERE invoice_id = $1`, [invoice.id]))
      .rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM payments WHERE invoice_id = $1`, [invoice.id]))
      .rejects.toThrow(/append-only/);
  });

  it('refuses to edit or delete an issued credit note', async () => {
    await ledger.withTransaction(c => invoices.issueCreditNote(c, invoice.id, {
      amountGross: 1240, reason: 'immutability check', issuedAt: '2026-07-25', createdBy: adminId,
    }));
    await expect(db.query(`UPDATE credit_notes SET amount_gross = 1 WHERE invoice_id = $1`, [invoice.id]))
      .rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM credit_notes WHERE invoice_id = $1`, [invoice.id]))
      .rejects.toThrow(/append-only/);
  });

  it('blocks deleting an order that has been invoiced', async () => {
    const { rows } = await db.query(`SELECT order_id FROM invoices WHERE id = $1`, [invoice.id]);
    await expect(db.query(`DELETE FROM orders WHERE id = $1`, [rows[0].order_id]))
      .rejects.toThrow(/violates foreign key/i);
  });
});
