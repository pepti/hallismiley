'use strict';

/**
 * An ARCHIVED variant is never matched, counted or received (harvest 2 lane
 * 6c on top of lane 6a; migration 119). Archiving frees a variant's SKU, so a
 * live variant may carry the same SKU as the archived one it replaced — the
 * receiving code matcher, the count screen's lookup and search, the count
 * batch and "Fix stock" must all see only the live one. Order fulfilment is
 * the exception: an order line may name an archived variant and must still
 * move its stock (applyLines without `refuseArchived`).
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const ProductVariant = require('../../server/models/ProductVariant');
const GoodsReceipt = require('../../server/models/GoodsReceipt');
const Inventory = require('../../server/models/Inventory');
const { getTestSessionCookie, cleanTables } = require('../helpers');

const SLUG = 'l6c-arc-';
const SKU = 'L6C-ARC-S';
let adminCookie, tee, archived, live;

beforeAll(async () => {
  await cleanTables();
  await db.query(`DELETE FROM goods_receipts WHERE supplier_name = 'L6c Archive Supplier'`);
  await db.query(`DELETE FROM products WHERE slug LIKE '${SLUG}%'`);
  adminCookie = await getTestSessionCookie();
  tee = await Product.create({ slug: SLUG + 'tee', name: 'L6c Archive Tee', price_isk: 1000, price_eur: 700, category: 'product', variant_axes: ['size'], active: true });
  // Opening stock leaves an inventory_adjustments row, so DELETE archives it.
  archived = await ProductVariant.create({ product_id: tee.id, sku: SKU, attributes: { size: 'S' }, stock: 4, barcode: '5690000066601' });
  const del = await request(app).delete(`/api/v1/admin/shop/products/${tee.id}/variants/${archived.id}`).set('Cookie', adminCookie);
  expect(del.body).toMatchObject({ archived: true });
  // The replacement: same SKU, same size — allowed because the archive freed both.
  live = await ProductVariant.create({ product_id: tee.id, sku: SKU, attributes: { size: 'S' }, stock: 2 });
});

afterAll(async () => {
  await db.query(`DELETE FROM goods_receipts WHERE supplier_name = 'L6c Archive Supplier'`);
  await db.query(`DELETE FROM products WHERE slug LIKE '${SLUG}%'`);
});

describe('receiving', () => {
  test('a receipt line matches the LIVE variant, not the archived twin (and not "ambiguous")', async () => {
    const [bySku, byOldBarcode] = await GoodsReceipt.matchCodes([{ sku: SKU }, { barcode: '5690000066601' }]);
    expect(bySku).toMatchObject({ productId: tee.id, variantId: live.id });
    expect(byOldBarcode.variantId || null).toBeNull(); // the archived variant's barcode names nothing now

    const receipt = await GoodsReceipt.create({ supplierName: 'L6c Archive Supplier' });
    await GoodsReceipt.addLines(receipt.id, [{ sku: SKU, expectedQty: 3 }]);
    const [line] = await GoodsReceipt.lines(receipt.id);
    expect(line).toMatchObject({ variant_id: live.id });
  });
});

describe('a draft receipt whose matched variant is deleted later', () => {
  test('finalise names the line (409 VARIANT_ARCHIVED), the line shows it, and nothing is received', async () => {
    const other = await ProductVariant.create({ product_id: tee.id, sku: 'L6C-ARC-M', attributes: { size: 'M' } });
    const receipt = await GoodsReceipt.create({ supplierName: 'L6c Archive Supplier' });
    await GoodsReceipt.addLines(receipt.id, [{ sku: 'L6C-ARC-M', expectedQty: 2 }]);
    const [line] = await GoodsReceipt.lines(receipt.id);
    await db.query('UPDATE goods_receipt_lines SET received_qty = 2 WHERE id = $1', [line.id]);
    // The line itself now names the variant, so DELETE archives it.
    const del = await request(app).delete(`/api/v1/admin/shop/products/${tee.id}/variants/${other.id}`).set('Cookie', adminCookie);
    expect(del.body).toMatchObject({ archived: true });
    expect((await GoodsReceipt.lines(receipt.id))[0]).toMatchObject({ id: line.id, variant_archived: true });
    const fin = await request(app).post(`/api/v1/admin/receiving/${receipt.id}/finalize`).set('Cookie', adminCookie).send({});
    expect(fin.status).toBe(409);
    expect(fin.body).toMatchObject({ reason: 'VARIANT_ARCHIVED', lineIds: [line.id] });
    expect((await ProductVariant.findById(other.id)).stock).toBe(0);
  });
});

describe('the stock count', () => {
  test('lookup and search give the live variant only', async () => {
    const look = await request(app).get(`/api/v1/admin/inventory/lookup?code=${SKU}`).set('Cookie', adminCookie);
    expect(look.status).toBe(200);
    expect(look.body.items.map(i => i.variant_id)).toEqual([live.id]);
    const found = await request(app).get('/api/v1/admin/inventory/search?q=L6C-ARC').set('Cookie', adminCookie);
    expect(found.body.items.map(i => i.variant_id)).toEqual([live.id]);
    const watch = await Inventory.watchRows();
    expect(watch.some(r => r.variant_id === archived.id)).toBe(false);
  });

  test('a count batch or "Fix stock" naming the archived variant is refused and moves nothing', async () => {
    const count = await request(app).post('/api/v1/admin/inventory/count').set('Cookie', adminCookie)
      .send({ reason: 'recount', lines: [{ productId: tee.id, variantId: archived.id, mode: 'set', qty: 9 }] });
    expect(count.status).toBeGreaterThanOrEqual(400);
    const fix = await request(app).patch('/api/v1/admin/inventory/stock').set('Cookie', adminCookie)
      .send({ productId: tee.id, variantId: archived.id, stock: 9 });
    expect(fix.status).toBeGreaterThanOrEqual(400);
    expect((await ProductVariant.findById(archived.id)).stock).toBe(4);
  });

  test('order fulfilment may still move an archived variant (an order line names it)', async () => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await Inventory.applyLines(client, [{ productId: tee.id, variantId: archived.id, mode: 'decrement', qty: 1 }]);
      const { rows } = await client.query('SELECT stock FROM product_variants WHERE id = $1', [archived.id]);
      expect(rows[0].stock).toBe(3);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
