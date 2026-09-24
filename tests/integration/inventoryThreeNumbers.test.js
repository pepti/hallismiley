'use strict';

/**
 * On hand / Committed / Available and the audited stock writer
 * (models/Inventory.js — harvested from icelandicstore #243/#275/#380,
 * harvest-ice-c-2026-09-24). The engine differences are pinned here too:
 * stock never goes below zero (a fulfilment the shelf cannot cover is a 409),
 * a PENDING order commits nothing, and the Stripe webhook refuses a payment
 * that Available cannot cover.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const ProductVariant = require('../../server/models/ProductVariant');
const Order   = require('../../server/models/Order');
const Inventory = require('../../server/models/Inventory');
const { getTestSessionCookie, cleanTables } = require('../helpers');

const SLUG = 'inv3-';
let adminCookie, adminId;

async function adjustments(productId) {
  const { rows } = await db.query(
    `SELECT product_variant_id, previous_stock, new_stock, delta, reason, note, user_id, order_id
       FROM inventory_adjustments WHERE product_id = $1 ORDER BY created_at, id`, [productId]
  );
  return rows;
}

async function mkProduct(slug, extra = {}) {
  return Product.create({ slug: SLUG + slug, name: `Inv ${slug}`, price_isk: 1000, price_eur: 700, category: 'product', ...extra });
}

async function mkOrder(items, { paid = true } = {}) {
  const order = await Order.createWithItems({
    guestEmail: 'inv3@example.com', guestName: 'Inv Test', currency: 'ISK',
    shippingMethod: 'local_pickup', shippingAddress: null, shipping: 0,
    items: items.map(i => ({ price: 1000, name: 'x', ...i })),
  });
  if (paid) await Order.setOrderStatuses(order.id, { payment_status: 'paid' });
  return order;
}

beforeAll(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();
  const { rows } = await db.query('SELECT user_id FROM user_sessions LIMIT 1');
  adminId = rows[0].user_id;
});

afterAll(async () => {
  await db.query(`DELETE FROM orders WHERE guest_email = 'inv3@example.com'`);
  await db.query(`DELETE FROM products WHERE slug LIKE '${SLUG}%'`);
});

describe('the audited writer', () => {
  test('opening stock on create is an "opening" row; zero opening stock writes none', async () => {
    const p = await mkProduct('open', { stock: 12 });
    expect(await adjustments(p.id)).toEqual([
      expect.objectContaining({ previous_stock: 0, new_stock: 12, delta: 12, reason: 'opening' }),
    ]);
    const z = await mkProduct('open0');
    expect(await adjustments(z.id)).toEqual([]);
  });

  test('an admin stock edit is audited with the actor, the reason and the note', async () => {
    const p = await mkProduct('edit', { stock: 10 });
    const res = await request(app).patch(`/api/v1/admin/shop/products/${p.id}`).set('Cookie', adminCookie)
      .send({ stock: 7, stock_reason: 'damaged', stock_note: 'dropped a box' });
    expect(res.status).toBe(200);
    expect(res.body.product.stock).toBe(7);
    const rows = await adjustments(p.id);
    expect(rows[rows.length - 1]).toMatchObject({
      previous_stock: 10, new_stock: 7, delta: -3, reason: 'damaged', note: 'dropped a box', user_id: adminId,
    });
  });

  test('two consecutive edits delta from the NEW figure; an unchanged figure writes nothing', async () => {
    const p = await mkProduct('twice', { stock: 10 });
    await request(app).patch(`/api/v1/admin/shop/products/${p.id}`).set('Cookie', adminCookie).send({ stock: 42 });
    await request(app).patch(`/api/v1/admin/shop/products/${p.id}`).set('Cookie', adminCookie).send({ stock: 50 });
    await request(app).patch(`/api/v1/admin/shop/products/${p.id}`).set('Cookie', adminCookie).send({ stock: 50, name: 'Renamed' });
    const moves = (await adjustments(p.id)).filter(r => r.reason === 'correction');
    expect(moves.map(r => [r.previous_stock, r.new_stock])).toEqual([[10, 42], [42, 50]]);
  });

  test('a negative or non-numeric stock, or an unknown reason, is a 400 and moves nothing', async () => {
    const p = await mkProduct('bad', { stock: 3 });
    for (const body of [{ stock: -1 }, { stock: 'abc' }, { stock: 2.5 }, { stock: 4, stock_reason: 'vibes' }]) {
      const res = await request(app).patch(`/api/v1/admin/shop/products/${p.id}`).set('Cookie', adminCookie).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 400 });
    }
    expect((await Product.findById(p.id)).stock).toBe(3);
    expect((await adjustments(p.id)).filter(r => r.reason !== 'opening')).toEqual([]);
  });

  test('the variant grid PATCH is audited on the variant, under the parent product', async () => {
    const p = await mkProduct('var', { variant_axes: ['size'] });
    const v = await ProductVariant.create({ product_id: p.id, sku: 'INV3-V-M', attributes: { size: 'M' }, stock: 4 });
    const res = await request(app).patch(`/api/v1/admin/shop/products/${p.id}/variants/${v.id}`)
      .set('Cookie', adminCookie).send({ stock: 9 });
    expect(res.status).toBe(200);
    expect(res.body.variant.stock).toBe(9);
    const rows = await adjustments(p.id);
    expect(rows.map(r => [r.product_variant_id, r.reason, r.delta])).toEqual([[v.id, 'opening', 4], [v.id, 'correction', 5]]);
    expect(rows[1].user_id).toBe(adminId);
  });

  test('a variant PATCH through ANOTHER product is a 404 and writes nothing', async () => {
    const a = await mkProduct('own-a', { variant_axes: ['size'] });
    const b = await mkProduct('own-b');
    const v = await ProductVariant.create({ product_id: a.id, sku: 'INV3-OWN', attributes: { size: 'S' }, stock: 1 });
    const res = await request(app).patch(`/api/v1/admin/shop/products/${b.id}/variants/${v.id}`)
      .set('Cookie', adminCookie).send({ stock: 99 });
    expect(res.status).toBe(404);
    expect((await ProductVariant.findById(v.id)).stock).toBe(1);
  });

  test('GET /products/:id/adjustments lists the trail, newest first, with who', async () => {
    const p = await mkProduct('hist', { stock: 2 });
    await request(app).patch(`/api/v1/admin/shop/products/${p.id}`).set('Cookie', adminCookie).send({ stock: 5, stock_reason: 'received' });
    const res = await request(app).get(`/api/v1/admin/shop/products/${p.id}/adjustments`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.adjustments.map(a => a.reason)).toEqual(['received', 'opening']);
    expect(res.body.adjustments[0].user_name).toBeTruthy();
  });
});

describe('Committed and Available', () => {
  test('a PAID order commits; a pending one does not; the public API sends available only', async () => {
    const p = await mkProduct('commit', { stock: 10 });
    await mkOrder([{ productId: p.id, quantity: 3 }], { paid: true });
    await mkOrder([{ productId: p.id, quantity: 4 }], { paid: false });

    const admin = await request(app).get(`/api/v1/admin/shop/products/${p.id}`).set('Cookie', adminCookie);
    expect(admin.body.product).toMatchObject({ on_hand: 10, committed: 3, available: 7 });

    const pub = await request(app).get(`/api/v1/shop/products/${SLUG}commit`);
    expect(pub.status).toBe(200);
    expect(pub.body.product.available).toBe(7);
    expect(pub.body.product).not.toHaveProperty('stock');
    expect(pub.body.product).not.toHaveProperty('committed');
    expect(pub.body.product).not.toHaveProperty('on_hand');

    const list = await request(app).get('/api/v1/shop/products');
    const row = list.body.products.find(x => x.slug === `${SLUG}commit`);
    expect(row.available).toBe(7);
    expect(row).not.toHaveProperty('stock');
  });

  test('variant availability is per variant, and the product rolls up', async () => {
    const p = await mkProduct('vcommit', { variant_axes: ['size'] });
    const s = await ProductVariant.create({ product_id: p.id, sku: 'INV3-VC-S', attributes: { size: 'S' }, stock: 5 });
    const m = await ProductVariant.create({ product_id: p.id, sku: 'INV3-VC-M', attributes: { size: 'M' }, stock: 2 });
    await mkOrder([{ productId: p.id, variantId: s.id, quantity: 2 }]);
    const pub = await request(app).get(`/api/v1/shop/products/${SLUG}vcommit`);
    const byId = Object.fromEntries(pub.body.product.variants.map(v => [v.id, v]));
    expect(byId[s.id].available).toBe(3);
    expect(byId[m.id].available).toBe(2);
    expect(byId[s.id]).not.toHaveProperty('stock');
    expect(pub.body.product.available).toBe(5);
  });

  test('availabilityShortfalls names the lines Available cannot cover; bookable services are never short', async () => {
    const p = await mkProduct('short', { stock: 4 });
    const svc = await mkProduct('svc', { category: 'tech_service', is_bookable: true, stock: 0 });
    await mkOrder([{ productId: p.id, quantity: 3 }]);
    const short = await Inventory.availabilityShortfalls(null, [
      { productId: p.id, qty: 2 }, { productId: svc.id, qty: 5 },
    ]);
    expect(short).toEqual([{ productId: p.id, variantId: null, wanted: 2, available: 1 }]);
    expect(await Inventory.availabilityShortfalls(null, [{ productId: p.id, qty: 1 }])).toEqual([]);
  });
});

describe('fulfilment moves on hand, once', () => {
  test('fulfil deducts + stamps, a second fulfil moves nothing, unfulfil restores — all audited with the order', async () => {
    const p = await mkProduct('ful', { stock: 10 });
    const o = await mkOrder([{ productId: p.id, quantity: 3 }]);
    const url = `/api/v1/admin/shop/orders/${o.id}/status`;

    let res = await request(app).patch(url).set('Cookie', adminCookie).send({ fulfillment_status: 'fulfilled' });
    expect(res.status).toBe(200);
    expect(res.body.order.stock_deducted_at).toBeTruthy();
    expect((await Product.findById(p.id)).stock).toBe(7);

    res = await request(app).patch(url).set('Cookie', adminCookie).send({ fulfillment_status: 'delivered' });
    expect(res.status).toBe(200);
    expect((await Product.findById(p.id)).stock).toBe(7);

    const admin = await request(app).get(`/api/v1/admin/shop/products/${p.id}`).set('Cookie', adminCookie);
    expect(admin.body.product).toMatchObject({ on_hand: 7, committed: 0, available: 7 });

    res = await request(app).patch(url).set('Cookie', adminCookie).send({ fulfillment_status: 'unfulfilled' });
    expect(res.status).toBe(200);
    expect(res.body.order.stock_deducted_at).toBeNull();
    expect((await Product.findById(p.id)).stock).toBe(10);

    const moves = (await adjustments(p.id)).filter(r => r.order_id);
    expect(moves.map(r => [r.reason, r.delta, r.order_id, r.user_id])).toEqual([
      ['fulfil', -3, o.id, adminId], ['unfulfil', 3, o.id, adminId],
    ]);
  });

  test('a fulfilment the shelf cannot cover is a 409 and changes nothing (stock never below zero)', async () => {
    const p = await mkProduct('ful-short', { stock: 5 });
    const o = await mkOrder([{ productId: p.id, quantity: 4 }]);
    await request(app).patch(`/api/v1/admin/shop/products/${p.id}`).set('Cookie', adminCookie).send({ stock: 2 });
    const res = await request(app).patch(`/api/v1/admin/shop/orders/${o.id}/status`)
      .set('Cookie', adminCookie).send({ fulfillment_status: 'fulfilled' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 409, reason: 'INSUFFICIENT_STOCK' });
    expect((await Product.findById(p.id)).stock).toBe(2);
    const order = await Order.findById(o.id);
    expect(order.fulfillment_status).toBe('unfulfilled');
    expect(order.stock_deducted_at).toBeNull();
  });

  test('a bookable service line never moves stock', async () => {
    const svc = await mkProduct('ful-svc', { category: 'tech_service', is_bookable: true, stock: 0 });
    const o = await mkOrder([{ productId: svc.id, quantity: 1 }]);
    const updated = await Order.setOrderStatuses(o.id, { fulfillment_status: 'fulfilled' });
    expect(updated.fulfillment_status).toBe('fulfilled');
    expect((await Product.findById(svc.id)).stock).toBe(0);
  });
});

describe('the Stripe webhook commits, it does not decrement', () => {
  const SECRET = 'whsec_inv3_test';
  let stripe;
  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_inv3_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const Stripe = require('stripe');
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  });

  async function deliver(order, { pi = null, id }) {
    await Order.setStripeSession(order.id, `cs_inv3_${id}`);
    const payload = JSON.stringify({
      id: `evt_inv3_${id}`, type: 'checkout.session.completed',
      data: { object: { id: `cs_inv3_${id}`, payment_intent: pi } },
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return request(app).post('/api/v1/shop/webhook')
      .set('Stripe-Signature', header).set('Content-Type', 'application/json').send(payload);
  }

  test('a payment Available covers marks the order paid and leaves on hand alone', async () => {
    const p = await mkProduct('wh-ok', { stock: 5 });
    const o = await mkOrder([{ productId: p.id, quantity: 2 }], { paid: false });
    const res = await deliver(o, { pi: `pi_inv3_${Date.now()}`, id: `ok${Date.now()}` });
    expect(res.status).toBe(200);
    expect((await Order.findById(o.id)).status).toBe('paid');
    expect((await Product.findById(p.id)).stock).toBe(5);
    const [row] = await Inventory.decorate([{ ...(await Product.findById(p.id)) }]);
    expect(row).toMatchObject({ committed: 2, available: 3 });
  });

  test('a payment that would oversell is refused: the order fails and nothing is committed', async () => {
    const p = await mkProduct('wh-lost', { stock: 3 });
    await mkOrder([{ productId: p.id, quantity: 2 }]);                     // paid, holds 2
    const o = await mkOrder([{ productId: p.id, quantity: 2 }], { paid: false });
    const res = await deliver(o, { pi: null, id: `lost${Date.now()}` });
    expect(res.status).toBe(200);
    expect((await Order.findById(o.id)).status).toBe('failed');
    expect((await Product.findById(p.id)).stock).toBe(3);
  });
});

describe('the migration backfill (112)', () => {
  test('a paid, unstamped order written the old way is stamped settled by the statement', async () => {
    const p = await mkProduct('bf', { stock: 1 });
    const o = await mkOrder([{ productId: p.id, quantity: 1 }], { paid: true });
    await db.query('UPDATE orders SET stock_deducted_at = NULL WHERE id = $1', [o.id]);
    const { migrations } = require('../../server/config/schema');
    const m = migrations.find(x => x.name === '112_inventory_adjustments');
    await db.query(m.statements[m.statements.length - 1]);
    expect((await Order.findById(o.id)).stock_deducted_at).toBeTruthy();
    const pending = await mkOrder([{ productId: p.id, quantity: 1 }], { paid: false });
    await db.query(m.statements[m.statements.length - 1]);
    expect((await Order.findById(pending.id)).stock_deducted_at).toBeNull();
  });
});

describe('lock order (ice #380): concurrent writers sharing rows do not deadlock', () => {
  test('two fulfilments whose carts list the same two products in opposite order both land', async () => {
    const a = await mkProduct('lock-a', { stock: 50 });
    const b = await mkProduct('lock-b', { stock: 50 });
    for (let i = 0; i < 5; i++) {
      const o1 = await mkOrder([{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }]);
      const o2 = await mkOrder([{ productId: b.id, quantity: 1 }, { productId: a.id, quantity: 1 }]);
      const results = await Promise.allSettled([
        Order.setOrderStatuses(o1.id, { fulfillment_status: 'fulfilled' }),
        Order.setOrderStatuses(o2.id, { fulfillment_status: 'fulfilled' }),
        // an order insert naming both rows, racing the fulfilments
        mkOrder([{ productId: b.id, quantity: 1 }, { productId: a.id, quantity: 1 }], { paid: false }),
      ]);
      expect(results.filter(r => r.status === 'rejected').map(r => r.reason && r.reason.code)).toEqual([]);
    }
    expect((await Product.findById(a.id)).stock).toBe(40);
    expect((await Product.findById(b.id)).stock).toBe(40);
  });
});

describe('POST /products/bulk (ice #247)', () => {
  test('edit applies the whitelisted fields to every selected product; activate/deactivate flip status', async () => {
    const a = await mkProduct('bulk-a', { vat_rate: 24 });
    const b = await mkProduct('bulk-b', { vat_rate: 24 });
    let res = await request(app).post('/api/v1/admin/shop/products/bulk').set('Cookie', adminCookie)
      .send({ ids: [a.id, b.id], action: 'edit', fields: { vat_rate: 11, bin: 'C-003', subcategory: '' } });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    for (const id of [a.id, b.id]) expect(await Product.findById(id)).toMatchObject({ vat_rate: 11, bin: 'C-003' });
    res = await request(app).post('/api/v1/admin/shop/products/bulk').set('Cookie', adminCookie)
      .send({ ids: [a.id], action: 'deactivate' });
    expect(res.body.updated).toBe(1);
    expect((await Product.findById(a.id)).active).toBe(false);
  });

  test('stock, price or an unknown field is refused; so is an empty edit and a bad VAT rate', async () => {
    const a = await mkProduct('bulk-c', { stock: 4 });
    for (const fields of [{ stock: 9 }, { price_isk: 1 }, { name: 'x' }, {}, { vat_rate: 7 }, { category: 'nope' }]) {
      const res = await request(app).post('/api/v1/admin/shop/products/bulk').set('Cookie', adminCookie)
        .send({ ids: [a.id], action: 'edit', fields });
      expect(res.status).toBe(400);
    }
    expect((await Product.findById(a.id)).stock).toBe(4);
    const noIds = await request(app).post('/api/v1/admin/shop/products/bulk').set('Cookie', adminCookie).send({ ids: [], action: 'activate' });
    expect(noIds.status).toBe(400);
  });
});
