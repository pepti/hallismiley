// The order's VAT snapshot (migration 121, harvest 2 lane 5) against real
// Postgres: the checkout writes order_items.vat_rate and orders.vat_total, and
// for an ISK order they are EXACTLY what the invoice later books
// (invoiceService.createFromOrder) — same lines, same rates, same krónur. Plus
// the export rule, an EUR order (snapshotted in cents), and the migration's
// approximate backfill for history.
//
// Stripe is stubbed at the service boundary (no network), as in shop.test.js.
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Product = require('../../server/models/Product');
const Discount = require('../../server/models/Discount');
const Setting = require('../../server/models/Setting');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const invoices = require('../../server/services/bookkeeping/invoiceService');
const stripeService = require('../../server/services/stripeService');
const { migrations } = require('../../server/config/schema');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

const EMAIL = 'vatsnap@example.com';
let adminId;
let table; let book; let consult; let savedKey; let spy;

beforeAll(async () => {
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
  await db.query(`DELETE FROM products WHERE slug LIKE 'vatsnap-%'`);
  table = await Product.create({ slug: 'vatsnap-table', name: 'Borð', price_isk: 12400, price_eur: 8900, category: 'product', stock: 50, vat_rate: 24 });
  book = await Product.create({ slug: 'vatsnap-book', name: 'Bók', price_isk: 4990, price_eur: 3500, category: 'product', stock: 50, vat_rate: 11 });
  consult = await Product.create({ slug: 'vatsnap-consult', name: 'Ráðgjöf', price_isk: 24800, price_eur: 17900, category: 'product', stock: 50, vat_rate: 24 });
  await db.query('UPDATE products SET is_bookable = TRUE WHERE id = $1', [consult.id]);
  await db.query(`DELETE FROM discounts WHERE code = 'VATSNAP10'`);
  await Discount.create({ code: 'VATSNAP10', title: 'Tíu prósent', value_type: 'percentage', value: 10 });
  await Setting.updateBookkeepingSettings({
    seller_name: 'Seljandi ehf.', seller_kennitala: '1203894599', seller_vat_number: '123456',
    seller_address: 'Dæmigata 1\n101 Reykjavík', payment_terms_days: 14,
  });
});

beforeEach(() => {
  savedKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_vat_snapshot_stub';
  let n = 0;
  spy = jest.spyOn(stripeService, 'createCheckoutSession')
    .mockImplementation(async () => ({ id: `cs_test_vatsnap_${Date.now()}_${n++}`, url: 'https://checkout.stripe.test/x' }));
});
afterEach(() => {
  spy.mockRestore();
  if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedKey;
});
afterAll(async () => {
  await db.query(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT i.id FROM invoices i JOIN orders o ON o.id = i.order_id WHERE o.guest_email = $1)`, [EMAIL]).catch(() => {});
  await db.pool.end();
});

const address = country => ({
  name: 'Jón Jónsson', line1: 'Bæjargata 5', city: country === 'IS' ? 'Reykjavík' : 'Oslo',
  postal: country === 'IS' ? '101' : '0150', country, country_code: country,
});

async function checkout({ items, currency = 'ISK', country = 'IS', method = 'flat_rate', code } = {}) {
  const res = await request(app).post('/api/v1/shop/checkout').send({
    items, currency, shipping_method: method,
    ...(method === 'flat_rate' ? { shipping_address: address(country) } : {}),
    guest_email: EMAIL, guest_name: 'Jón Jónsson',
    ...(code ? { discount_code: code } : {}),
  });
  expect(res.status).toBe(201);
  const { rows } = await db.query(
    `SELECT id, total, shipping, shipping_discount, discount_amount, vat_total, currency
       FROM orders WHERE order_number = $1`, [res.body.orderNumber]
  );
  const order = rows[0];
  const { rows: lines } = await db.query(
    `SELECT id, product_id, vat_rate FROM order_items WHERE order_id = $1 ORDER BY created_at, id`, [order.id]
  );
  return { order, lines };
}

async function invoiceFor(orderId) {
  await db.query(`UPDATE orders SET payment_status = 'paid', status = 'paid', paid_at = now() WHERE id = $1`, [orderId]);
  const { invoice } = await ledger.withTransaction(c => invoices.createFromOrder(c, orderId, { createdBy: adminId }));
  const { rows } = await db.query(
    `SELECT vat_rate, line_vat::int AS line_vat, description FROM invoice_lines
      WHERE invoice_id = $1 ORDER BY sort_order`, [invoice.id]
  );
  return { invoice, lines: rows };
}

describe('the checkout snapshot equals what the invoice books (ISK)', () => {
  test('mixed rates, a service, shipping and a percentage discount', async () => {
    const { order, lines } = await checkout({
      items: [
        { productId: table.id, quantity: 2 },
        { productId: book.id, quantity: 3 },
        { productId: consult.id, quantity: 1 },
      ],
      code: 'VATSNAP10',
    });
    expect(Number(order.discount_amount)).toBeGreaterThan(0);
    expect(order.vat_total).not.toBeNull();
    expect(lines.map(l => l.vat_rate)).toEqual(expect.arrayContaining([24, 11]));

    const { invoice, lines: booked } = await invoiceFor(order.id);
    expect(Number(invoice.vat_total)).toBe(order.vat_total);
    const goods = booked.filter(l => l.description !== 'Sending' && l.description !== 'Sléttun');
    expect(goods.map(l => l.vat_rate)).toEqual(lines.map(l => l.vat_rate));
  });

  test('local pickup, one line', async () => {
    const { order, lines } = await checkout({ items: [{ productId: book.id, quantity: 1 }], method: 'local_pickup' });
    expect(lines[0].vat_rate).toBe(11);
    expect(order.vat_total).toBe(Math.round(4990 * 11 / 111));
    const { invoice } = await invoiceFor(order.id);
    expect(Number(invoice.vat_total)).toBe(order.vat_total);
  });

  test('an export zero-rates goods and shipping; the service keeps its rate', async () => {
    const { order, lines } = await checkout({
      items: [{ productId: table.id, quantity: 1 }, { productId: consult.id, quantity: 1 }],
      country: 'NO',
    });
    expect(lines.map(l => l.vat_rate).sort()).toEqual([0, 24]);
    expect(order.vat_total).toBe(Math.round(24800 * 24 / 124));
    const { invoice } = await invoiceFor(order.id);
    expect(Number(invoice.vat_total)).toBe(order.vat_total);
  });
});

test('an EUR order is snapshotted in cents, in its own currency', async () => {
  const { order, lines } = await checkout({ items: [{ productId: table.id, quantity: 1 }], currency: 'EUR', method: 'local_pickup' });
  expect(order.currency).toBe('EUR');
  expect(lines[0].vat_rate).toBe(24);
  expect(order.vat_total).toBe(Math.round(8900 * 24 / 124));
});

describe('migration 121 backfill (history, approximate)', () => {
  const entry = migrations.find(m => m.name === '121_order_vat_snapshot');
  const backfill = entry.statements.slice(2);

  test('fills an order with no snapshot from the current rates, and never touches one that has it', async () => {
    const mk = async (vatTotal) => {
      const { rows } = await db.query(
        `INSERT INTO orders (order_number, guest_email, guest_name, currency, subtotal, shipping, total, status,
            shipping_method, shipping_address, discount_amount, payment_status, paid_at, vat_total)
         VALUES ($1, $2, 'Saga', 'ISK', 17390, 1000, 18390, 'paid', 'flat_rate', $3::jsonb, 0, 'paid', now(), $4)
         RETURNING id`,
        [`VATSNAP-${Math.random().toString(36).slice(2, 8)}`, EMAIL, JSON.stringify(address('IS')), vatTotal]
      );
      for (const [p, price, qty] of [[table, 12400, 1], [book, 4990, 1]]) {
        await db.query(
          `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_snapshot, quantity, currency)
           VALUES ($1, $2, $3, $4, $5, 'ISK')`, [rows[0].id, p.id, p.name, price, qty]
        );
      }
      return rows[0].id;
    };
    const blank = await mk(null);
    const kept = await mk(12345);
    for (const sql of backfill) await db.query(sql);

    const { rows } = await db.query('SELECT id, vat_total FROM orders WHERE id = ANY($1)', [[blank, kept]]);
    const byId = Object.fromEntries(rows.map(r => [r.id, r.vat_total]));
    // 12 400 @24 % = 2 400; 4 990 @11 % = 495; 1 000 shipping @24 % = 194.
    expect(byId[blank]).toBe(2400 + 495 + 194);
    expect(byId[kept]).toBe(12345);
    const { rows: rates } = await db.query(
      'SELECT order_id, vat_rate FROM order_items WHERE order_id = ANY($1) ORDER BY vat_rate', [[blank, kept]]
    );
    expect(rates.filter(r => r.order_id === blank).map(r => r.vat_rate)).toEqual([11, 24]);
    expect(rates.filter(r => r.order_id === kept).every(r => r.vat_rate === null)).toBe(true);
  });
});
