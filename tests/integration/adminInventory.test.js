'use strict';

/**
 * Inventory Watch, "Fix stock" and the stock count (harvest2-lane6a-2026-09-26;
 * ported from icelandicstore #13/#15/#18). Pins:
 *   - the report: one row per stocked unit, velocity from PAID order lines in
 *     the window, bucketed on Available; the `inventory` view gates it, and
 *     'sales' (which guards the rest of /reports) does not open it;
 *   - Fix stock: strict body (ice #15), audited through Inventory.correct,
 *     never below zero, never a product-level count on a variant product;
 *   - the count: ONE batch, one audit row per line sharing a batch_id, all or
 *     nothing, every below-zero line named, a re-sent token refused, and two
 *     batches on one variant serialised by the row lock.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const ProductVariant = require('../../server/models/ProductVariant');
const Order   = require('../../server/models/Order');
const Inventory = require('../../server/models/Inventory');
const Role    = require('../../server/models/Role');
const {
  getTestSessionCookie, cleanTables, createTestAdminUser, createTestRegularUser,
} = require('../helpers');

const SLUG = 'l6a-inv-';
const REPORT = '/api/v1/admin/shop/reports/inventory';
const BASE = '/api/v1/admin/inventory';
let adminCookie, adminId, userCookie, invCookie, salesCookie;

async function mkProduct(slug, extra = {}) {
  return Product.create({ slug: SLUG + slug, name: `Inv ${slug}`, price_isk: 1000, price_eur: 700, category: 'product', ...extra });
}

async function mkOrder(items, { status = 'paid', daysAgo = 0 } = {}) {
  const order = await Order.createWithItems({
    guestEmail: 'l6a-inv@example.com', guestName: 'L6a', currency: 'ISK',
    shippingMethod: 'local_pickup', shippingAddress: null, shipping: 0,
    items: items.map(i => ({ price: 1000, name: 'x', ...i })),
  });
  if (status === 'paid') await Order.setOrderStatuses(order.id, { payment_status: 'paid' });
  if (status === 'cancelled') await Order.setOrderStatuses(order.id, { status: 'cancelled' });
  // An old order has long left the building: backdated AND settled.
  if (daysAgo) await db.query(`UPDATE orders SET created_at = NOW() - ($2::int * INTERVAL '1 day'), stock_deducted_at = NOW() WHERE id = $1`, [order.id, daysAgo]);
  return order;
}

async function rows(productId) {
  const { rows: r } = await db.query(
    `SELECT product_variant_id, previous_stock, new_stock, delta, reason, note, user_id, batch_id, client_token
       FROM inventory_adjustments WHERE product_id = $1 AND reason <> 'opening' ORDER BY created_at, id`, [productId]
  );
  return r;
}

async function stockOf(productId, variantId = null) {
  const { rows: r } = variantId
    ? await db.query('SELECT stock FROM product_variants WHERE id = $1', [variantId])
    : await db.query('SELECT stock FROM products WHERE id = $1', [productId]);
  return r[0].stock;
}

async function roleUser(name, views) {
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system)
     VALUES ($1, 'l6a test role', $2::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`,
    [name, JSON.stringify(views)]
  );
  Role.invalidateCache();
  const id = `l6a-${name}`;
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ($1, $2, $3, (SELECT password_hash FROM users WHERE id = $4), $5, TRUE)`,
    [id, `${name}@l6a.test`, name, adminId, name]
  );
  return getTestSessionCookie(id);
}

beforeAll(async () => {
  await cleanTables();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie = await getTestSessionCookie(await createTestRegularUser());
  invCookie = await roleUser('l6ainv', ['inventory']);
  salesCookie = await roleUser('l6asales', ['sales']);
});

afterAll(async () => {
  await db.query(`DELETE FROM orders WHERE guest_email = 'l6a-inv@example.com'`);
  await db.query(`DELETE FROM products WHERE slug LIKE '${SLUG}%'`);
});

describe('GET /reports/inventory (Inventory Watch)', () => {
  test('gated on the inventory view: 401, 403 for a customer and for a sales-only role, 200 for inventory and admin', async () => {
    expect((await request(app).get(REPORT)).status).toBe(401);
    expect((await request(app).get(REPORT).set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).get(REPORT).set('Cookie', salesCookie)).status).toBe(403);
    expect((await request(app).get(REPORT).set('Cookie', invCookie)).status).toBe(200);
    expect((await request(app).get(REPORT).set('Cookie', adminCookie)).status).toBe(200);
    // …and the sales role still has the sales report the /reports prefix guards.
    expect((await request(app).get('/api/v1/admin/shop/reports').set('Cookie', salesCookie)).status).not.toBe(403);
  });

  test('one row per stocked unit; velocity counts paid lines in the window only; status on Available', async () => {
    const mug = await mkProduct('mug', { stock: 10, sku: 'L6A-MUG' });
    const tee = await mkProduct('tee', { variant_axes: ['size'] });
    const m = await ProductVariant.create({ product_id: tee.id, sku: 'L6A-TEE-M', attributes: { size: 'M' }, stock: 3 });
    const l = await ProductVariant.create({ product_id: tee.id, sku: 'L6A-TEE-L', attributes: { size: 'L' }, stock: 50 });
    const svc = await mkProduct('svc', { is_bookable: true, category: 'tech_service', stock: 0 });
    // mug: 30 paid units in the window → 10/mo; 4 of them unfulfilled paid → committed.
    await mkOrder([{ productId: mug.id, quantity: 26 }]);
    await mkOrder([{ productId: mug.id, quantity: 4 }]);
    await db.query(`UPDATE orders SET stock_deducted_at = NOW() WHERE guest_email = 'l6a-inv@example.com' AND id IN (
      SELECT order_id FROM order_items WHERE product_id = $1 AND quantity = 26)`, [mug.id]);
    // Not velocity: a pending order, a cancelled one, and one from 200 days ago.
    await mkOrder([{ productId: mug.id, quantity: 100 }], { status: 'pending' });
    await mkOrder([{ productId: mug.id, quantity: 100 }], { status: 'cancelled' });
    await mkOrder([{ productId: mug.id, quantity: 100 }], { daysAgo: 200 });
    // tee M: 6 paid in the window → 2/mo, 3 on hand (all 6 committed? no — deducted)
    const tm = await mkOrder([{ productId: tee.id, variantId: m.id, quantity: 6 }]);
    await db.query('UPDATE orders SET stock_deducted_at = NOW() WHERE id = $1', [tm.id]);

    const res = await request(app).get(REPORT).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const items = res.body.report.items.filter(i => String(i.name).startsWith('Inv '));
    const byKey = Object.fromEntries(items.map(i => [i.key, i]));
    expect(Object.keys(byKey).sort()).toEqual([`p:${mug.id}`, `v:${l.id}`, `v:${m.id}`].sort());
    expect(byKey[`p:${svc.id}`]).toBeUndefined();          // bookable: no stock
    expect(byKey[`p:${tee.id}`]).toBeUndefined();          // a variant product is its variants
    expect(byKey[`p:${mug.id}`]).toMatchObject({ on_hand: 10, committed: 4, available: 6, units_window: 30, status: 'low' });
    expect(byKey[`v:${m.id}`]).toMatchObject({ on_hand: 3, committed: 0, available: 3, units_window: 6, status: 'watch', attributes: { size: 'M' } });
    expect(byKey[`v:${l.id}`]).toMatchObject({ units_window: 0, status: 'ok' });
    expect(res.body.report.counts.low).toBeGreaterThanOrEqual(1);
  });
});

describe('PATCH /inventory/stock (Fix stock)', () => {
  test('strict body: booleans, arrays, blanks, fractions, negatives, a bad reason — all 400, nothing moves', async () => {
    const p = await mkProduct('fix-bad', { stock: 5 });
    const bodies = [
      { stock: true, reason: 'correction' }, { stock: [], reason: 'correction' }, { stock: '', reason: 'correction' },
      { stock: '1.5', reason: 'correction' }, { stock: -1, reason: 'correction' }, { stock: null, reason: 'correction' },
      { stock: 3, reason: 'vibes' }, { stock: 3 }, { stock: 3, reason: 'correction', note: 42 },
    ];
    for (const b of bodies) {
      const res = await request(app).patch(`${BASE}/stock`).set('Cookie', adminCookie).send({ productId: p.id, ...b });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 400 });
    }
    const big = await request(app).patch(`${BASE}/stock`).set('Cookie', adminCookie)
      .send({ productId: p.id, stock: Inventory.MAX_STOCK_VALUE + 1, reason: 'correction' });
    expect(big.status).toBe(400);
    expect(big.body.error).toMatch(String(Inventory.MAX_STOCK_VALUE).slice(0, 3));
    expect(await stockOf(p.id)).toBe(5);
    expect(await rows(p.id)).toEqual([]);
  });

  test('sets an absolute count, audited with the actor, reason and note; the same count writes nothing', async () => {
    const p = await mkProduct('fix-ok', { stock: 5 });
    const res = await request(app).patch(`${BASE}/stock`).set('Cookie', invCookie)
      .send({ productId: p.id, stock: '12', reason: 'recount', note: 'shelf B' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ previous: 5, stock: 12, delta: 7 });
    expect(res.body.item).toMatchObject({ on_hand: 12, available: 12 });
    const again = await request(app).patch(`${BASE}/stock`).set('Cookie', invCookie)
      .send({ productId: p.id, stock: 12, reason: 'recount' });
    expect(again.body).toMatchObject({ delta: 0, adjustmentId: null });
    expect(await rows(p.id)).toEqual([
      expect.objectContaining({ previous_stock: 5, new_stock: 12, delta: 7, reason: 'recount', note: 'shelf B', user_id: 'l6a-l6ainv' }),
    ]);
  });

  test('a variant is fixed on the variant; a product-level fix on a variant product is 409; a foreign variant 404', async () => {
    const tee = await mkProduct('fix-var', { variant_axes: ['size'] });
    const other = await mkProduct('fix-other');
    const v = await ProductVariant.create({ product_id: tee.id, sku: 'L6A-FIX-S', attributes: { size: 'S' }, stock: 2 });
    const ok = await request(app).patch(`${BASE}/stock`).set('Cookie', adminCookie)
      .send({ productId: tee.id, variantId: v.id, stock: 0, reason: 'damaged' });
    expect(ok.status).toBe(200);
    expect(await stockOf(tee.id, v.id)).toBe(0);
    const parent = await request(app).patch(`${BASE}/stock`).set('Cookie', adminCookie)
      .send({ productId: tee.id, stock: 9, reason: 'correction' });
    expect(parent.status).toBe(409);
    expect(parent.body.lines[0]).toMatchObject({ reason: 'VARIANT_REQUIRED' });
    const foreign = await request(app).patch(`${BASE}/stock`).set('Cookie', adminCookie)
      .send({ productId: other.id, variantId: v.id, stock: 9, reason: 'correction' });
    expect(foreign.status).toBe(404);
    expect(await stockOf(tee.id, v.id)).toBe(0);
  });
});

describe('lookup + search', () => {
  test('a variant code gives the variant; the parent code gives its variants and variantRequired; unknown is 404', async () => {
    const tee = await mkProduct('look', { variant_axes: ['size'], sku: 'L6A-LOOK' });
    const s = await ProductVariant.create({ product_id: tee.id, sku: 'L6A-LOOK-S', attributes: { size: 'S' }, stock: 1, barcode: '5690000000017' });
    await ProductVariant.create({ product_id: tee.id, sku: 'L6A-LOOK-M', attributes: { size: 'M' }, stock: 2 });
    const byBarcode = await request(app).get(`${BASE}/lookup?code=5690000000017`).set('Cookie', invCookie);
    expect(byBarcode.status).toBe(200);
    expect(byBarcode.body).toMatchObject({ variantRequired: false, items: [expect.objectContaining({ variant_id: s.id, on_hand: 1 })] });
    const parent = await request(app).get(`${BASE}/lookup?code=L6A-LOOK`).set('Cookie', invCookie);
    expect(parent.body.variantRequired).toBe(true);
    expect(parent.body.items.map(i => i.sku).sort()).toEqual(['L6A-LOOK-M', 'L6A-LOOK-S']);
    expect((await request(app).get(`${BASE}/lookup?code=NOPE-L6A`).set('Cookie', invCookie)).status).toBe(404);
    expect((await request(app).get(`${BASE}/lookup?code=`).set('Cookie', invCookie)).status).toBe(400);
    const found = await request(app).get(`${BASE}/search?q=L6A-LOOK`).set('Cookie', invCookie);
    // Stocked units only: the two variants, never the variant product's own row.
    expect(found.body.items.map(i => i.sku).sort()).toEqual(['L6A-LOOK-M', 'L6A-LOOK-S']);
    expect((await request(app).get(`${BASE}/search?q=x`).set('Cookie', salesCookie)).status).toBe(403);
  });
});

describe('POST /inventory/count (one audited batch)', () => {
  test('set / add / remove in one batch: one row per line, one shared batch_id, reason and note on each', async () => {
    const a = await mkProduct('cnt-a', { stock: 10 });
    const b = await mkProduct('cnt-b', { stock: 3 });
    const tee = await mkProduct('cnt-t', { variant_axes: ['size'] });
    const v = await ProductVariant.create({ product_id: tee.id, sku: 'L6A-CNT-V', attributes: { size: 'XL' }, stock: 4 });
    const res = await request(app).post(`${BASE}/count`).set('Cookie', invCookie).send({
      reason: 'recount', note: 'Q3 count',
      lines: [
        { productId: a.id, mode: 'set', qty: 7 },
        { productId: b.id, mode: 'increment', qty: '2' },
        { productId: tee.id, variantId: v.id, mode: 'decrement', qty: 4 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map(r => [r.previous, r.stock])).toEqual([[10, 7], [3, 5], [4, 0]]);
    const all = [...await rows(a.id), ...await rows(b.id), ...await rows(tee.id)];
    expect(all).toHaveLength(3);
    expect(new Set(all.map(r => r.batch_id)).size).toBe(1);
    expect(all[0].batch_id).toBe(res.body.batchId);
    for (const r of all) expect(r).toMatchObject({ reason: 'recount', note: 'Q3 count', user_id: 'l6a-l6ainv' });
  });

  test('a line that would go below zero refuses the WHOLE batch, naming every such line', async () => {
    const a = await mkProduct('neg-a', { stock: 5 });
    const b = await mkProduct('neg-b', { stock: 1 });
    const c = await mkProduct('neg-c', { stock: 2 });
    const res = await request(app).post(`${BASE}/count`).set('Cookie', adminCookie).send({
      lines: [
        { productId: a.id, mode: 'increment', qty: 10 },
        { productId: b.id, mode: 'decrement', qty: 3 },
        { productId: c.id, mode: 'decrement', qty: 9 },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 409, reason: 'INSUFFICIENT_STOCK' });
    expect(res.body.lines.map(l => [l.line, l.onHand, l.result, l.reason])).toEqual([[2, 1, -2, 'NEGATIVE'], [3, 2, -7, 'NEGATIVE']]);
    expect(res.body.lines[0].name).toBe('Inv neg-b');
    expect(res.body.lines[0].message).toMatch(/Inv neg-b/);
    expect([await stockOf(a.id), await stockOf(b.id), await stockOf(c.id)]).toEqual([5, 1, 2]);
    expect([...await rows(a.id), ...await rows(b.id), ...await rows(c.id)]).toEqual([]);
  });

  test('malformed batches are 400 with the line: bad mode, bad qty, zero add, a duplicate, empty; a variant parent is 409', async () => {
    const p = await mkProduct('bad-batch', { stock: 5 });
    const tee = await mkProduct('bad-par', { variant_axes: ['size'] });
    await ProductVariant.create({ product_id: tee.id, sku: 'L6A-BAD-V', attributes: { size: 'S' }, stock: 1 });
    const cases = [
      [{ lines: [{ productId: p.id, mode: 'double', qty: 1 }] }, 1],
      [{ lines: [{ productId: p.id, mode: 'set', qty: true }] }, 1],
      [{ lines: [{ productId: p.id, mode: 'set', qty: 1 }, { productId: p.id, mode: 'set', qty: -2 }] }, 2],
      [{ lines: [{ productId: p.id, mode: 'increment', qty: 0 }] }, 1],
      [{ lines: [{ productId: p.id, mode: 'set', qty: 1 }, { productId: p.id, mode: 'increment', qty: 1 }] }, 2],
      [{ lines: [] }, null],
      [{ lines: [{ productId: p.id, mode: 'set', qty: 1 }], reason: 'vibes' }, undefined],
    ];
    for (const [body, line] of cases) {
      const res = await request(app).post(`${BASE}/count`).set('Cookie', adminCookie).send(body);
      expect(res.status).toBe(400);
      if (line !== undefined) expect(res.body.line).toBe(line);
    }
    const parent = await request(app).post(`${BASE}/count`).set('Cookie', adminCookie)
      .send({ lines: [{ productId: p.id, mode: 'set', qty: 9 }, { productId: tee.id, mode: 'set', qty: 3 }] });
    expect(parent.status).toBe(409);
    expect(parent.body).toMatchObject({ reason: 'BATCH_REFUSED' });
    expect(parent.body.lines).toEqual([expect.objectContaining({ line: 2, reason: 'VARIANT_REQUIRED' })]);
    expect(await stockOf(p.id)).toBe(5);
  });

  test('a variant product counted at product level AND by one of its variants is refused before any lock', async () => {
    const tee = await mkProduct('pre-par', { variant_axes: ['size'] });
    const v = await ProductVariant.create({ product_id: tee.id, sku: 'L6A-PRE-V', attributes: { size: 'M' }, stock: 3 });
    const res = await request(app).post(`${BASE}/count`).set('Cookie', adminCookie).send({
      lines: [{ productId: tee.id, variantId: v.id, mode: 'set', qty: 5 }, { productId: tee.id, mode: 'set', qty: 9 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.lines).toEqual([expect.objectContaining({ line: 2, reason: 'VARIANT_REQUIRED' })]);
    expect(await stockOf(tee.id, v.id)).toBe(3);
  });

  test('a refused batch inside a CALLER\'s transaction is rolled back to its savepoint — the caller\'s own writes survive', async () => {
    const a = await mkProduct('sp-a', { stock: 2 });
    const b = await mkProduct('sp-b', { stock: 0 });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE products SET bin = 'SP-1' WHERE id = $1`, [a.id]);
      await expect(Inventory.applyBatch([
        { productId: a.id, mode: 'increment', qty: 5 },
        { productId: b.id, mode: 'decrement', qty: 1 },
      ], { userId: adminId }, client)).rejects.toMatchObject({ code: 'BATCH_REFUSED' });
      await client.query('COMMIT');       // a careless caller commits anyway
    } finally { client.release(); }
    expect(await stockOf(a.id)).toBe(2);   // nothing of the batch
    expect((await db.query('SELECT bin FROM products WHERE id = $1', [a.id])).rows[0].bin).toBe('SP-1');
    expect(await rows(a.id)).toEqual([]);
  });

  test('a re-sent count is answered "already saved" even when a line would now be refused', async () => {
    const p = await mkProduct('token2', { stock: 5 });
    const body = { clientToken: 'l6a-token-00000002', lines: [{ productId: p.id, mode: 'decrement', qty: 5 }] };
    expect((await request(app).post(`${BASE}/count`).set('Cookie', adminCookie).send(body)).status).toBe(200);
    const again = await request(app).post(`${BASE}/count`).set('Cookie', adminCookie).send(body);
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('DUPLICATE_BATCH');
    expect(await stockOf(p.id)).toBe(0);
  });

  test('a re-sent count (same client token) is refused whole — nothing moves twice', async () => {
    const p = await mkProduct('token', { stock: 1 });
    const body = { clientToken: 'l6a-token-00000001', lines: [{ productId: p.id, mode: 'increment', qty: 5 }] };
    const first = await request(app).post(`${BASE}/count`).set('Cookie', adminCookie).send(body);
    expect(first.status).toBe(200);
    const again = await request(app).post(`${BASE}/count`).set('Cookie', adminCookie).send(body);
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('DUPLICATE_BATCH');
    expect(await stockOf(p.id)).toBe(6);
    expect(await rows(p.id)).toHaveLength(1);
    const bad = await request(app).post(`${BASE}/count`).set('Cookie', adminCookie)
      .send({ ...body, clientToken: 'short' });
    expect(bad.status).toBe(400);
  });

  test('concurrency: two batches adding to one variant serialise — both land, the audit chain is continuous', async () => {
    const tee = await mkProduct('race', { variant_axes: ['size'] });
    const v = await ProductVariant.create({ product_id: tee.id, sku: 'L6A-RACE', attributes: { size: 'M' }, stock: 10 });
    const other = await mkProduct('race-o', { stock: 1 });
    const batch = (qty, extra) => Inventory.applyBatch([
      ...(extra ? [{ productId: other.id, mode: 'increment', qty: 1 }] : []),
      { productId: tee.id, variantId: v.id, mode: 'increment', qty },
    ], { userId: adminId, reason: 'recount' });
    const results = await Promise.all([batch(3, true), batch(4, false), batch(5, true)]);
    expect(results).toHaveLength(3);
    expect(await stockOf(tee.id, v.id)).toBe(22);
    // created_at is each transaction's START (NOW()), not its commit, so the
    // rows are put in chain order by their figures: all increments, so every
    // row must start where another ended.
    const chain = (await rows(tee.id)).map(r => [r.previous_stock, r.new_stock]).sort((a, b) => a[0] - b[0]);
    expect(chain).toHaveLength(3);
    for (let i = 1; i < chain.length; i += 1) expect(chain[i][0]).toBe(chain[i - 1][1]);
    expect(chain[0][0]).toBe(10);
    expect(chain[2][1]).toBe(22);
  });

  test('concurrency: two batches that cannot both fit — exactly one wins, the other is refused, stock never below zero', async () => {
    const p = await mkProduct('race-neg', { stock: 5 });
    const take = () => Inventory.applyBatch([{ productId: p.id, mode: 'decrement', qty: 4 }], { userId: adminId, reason: 'damaged' })
      .then(() => 'ok', (err) => err.code);
    const outcome = (await Promise.all([take(), take()])).sort();
    expect(outcome).toEqual(['BATCH_REFUSED', 'ok']);
    expect(await stockOf(p.id)).toBe(1);
    expect(await rows(p.id)).toHaveLength(1);
  });
});
