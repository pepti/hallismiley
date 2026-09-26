'use strict';
/**
 * What the public shop API may NOT hand a visitor or a customer (harvest 2,
 * 2026-09-26):
 *  - the catalogue carries no warehouse codes — `bin` (the shelf location),
 *    `sku`, `barcode` — on a product or on any of its variants (icelandicstore
 *    #62; the storefront reads none of them);
 *  - a customer's own order list is an allow-list (icelandicstore #416 G5,
 *    customerOrderView): no Stripe ids, no stock-settlement stamp, no staff tags.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const ProductVariant = require('../../server/models/ProductVariant');
const { cleanTables, createTestRegularUser, getTestSessionCookie } = require('../helpers');

const SLUG = 'privacy-test-mug';
const INTERNALS = ['bin', 'sku', 'barcode', 'stock', 'on_hand', 'committed'];

// Every key anywhere in a JSON value.
function keysDeep(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach(v => keysDeep(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.add(k); keysDeep(v, out); }
  }
  return out;
}

let userCookie;

beforeAll(async () => {
  await cleanTables();
  await db.query('DELETE FROM products WHERE slug = $1', [SLUG]);
  const p = await Product.create({
    slug: SLUG, name: 'Privacy mug', price_isk: 2000, price_eur: 1400,
    sku: 'PRIV-MUG', barcode: '5690000000017', bin: 'A-03-2', stock: 7,
  });
  await ProductVariant.create({
    product_id: p.id, sku: 'PRIV-MUG-L', barcode: '5690000000024', bin: 'A-03-3',
    attributes: { size: 'L' }, stock: 3,
  });
  const userId = await createTestRegularUser();
  userCookie = await getTestSessionCookie(userId);
  await db.query(
    `INSERT INTO orders (order_number, user_id, currency, subtotal, shipping, total, status, payment_status,
                         shipping_method, stripe_session_id, stripe_payment_intent_id, stock_deducted_at, tags, paid_at)
     VALUES ('PRIV-1001', $1, 'ISK', 2000, 0, 2000, 'paid', 'paid', 'local_pickup',
             'cs_test_secret', 'pi_test_secret', NOW(), '["vip","staff-note"]'::jsonb, NOW())`,
    [userId]
  );
});

afterAll(async () => {
  await db.query('DELETE FROM products WHERE slug = $1', [SLUG]);
  await cleanTables();
  await db.pool.end();
});

describe('the public catalogue carries no warehouse codes', () => {
  test('GET /api/v1/shop/products (anonymous)', async () => {
    const res = await request(app).get('/api/v1/shop/products');
    expect(res.status).toBe(200);
    const mine = res.body.products.find(p => p.slug === SLUG);
    expect(mine).toBeDefined();
    expect(mine.variants).toHaveLength(1);
    const keys = keysDeep(res.body.products);
    for (const k of INTERNALS) expect([k, keys.has(k)]).toEqual([k, false]);
    // The one inventory number a visitor gets is still there.
    expect(mine).toHaveProperty('available');
  });

  test('GET /api/v1/shop/products/:slug (anonymous)', async () => {
    const res = await request(app).get(`/api/v1/shop/products/${SLUG}`);
    expect(res.status).toBe(200);
    const keys = keysDeep(res.body.product);
    for (const k of INTERNALS) expect([k, keys.has(k)]).toEqual([k, false]);
    expect(JSON.stringify(res.body)).not.toMatch(/A-03-|PRIV-MUG|5690000000/);
  });

  test('a signed-in customer gets the same public shape', async () => {
    const res = await request(app).get(`/api/v1/shop/products/${SLUG}`).set('Cookie', userCookie);
    expect(JSON.stringify(res.body)).not.toMatch(/A-03-|PRIV-MUG/);
  });
});

describe('GET /api/v1/shop/orders/mine — an allow-listed shape', () => {
  test('carries what the order history reads and none of the staff fields', async () => {
    const res = await request(app).get('/api/v1/shop/orders/mine').set('Cookie', userCookie);
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    const [order] = res.body.orders;
    expect(order).toMatchObject({ order_number: 'PRIV-1001', status: 'paid', currency: 'ISK' });
    expect(Number(order.total)).toBe(2000);
    expect(order.created_at).toBeTruthy();
    for (const k of ['stripe_session_id', 'stripe_payment_intent_id', 'stock_deducted_at', 'tags']) {
      expect([k, k in order]).toEqual([k, false]);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/cs_test_secret|pi_test_secret|staff-note/);
  });

  test('anonymous is 401', async () => {
    const res = await request(app).get('/api/v1/shop/orders/mine');
    expect(res.status).toBe(401);
  });
});
