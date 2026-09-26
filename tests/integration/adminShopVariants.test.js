'use strict';

/**
 * Variants that work (harvest 2 lane 6c, ported from icelandicstore #194 and
 * #432; migration 119). The admin grid's four routes plus the bulk route:
 *   - POST keeps barcode + bin (they used to be dropped) and answers localised
 *     400s from validateVariant;
 *   - PATCH is scoped to the product in the path and can fix an option value;
 *   - DELETE really deletes a variant nothing names — and frees its SKU — but
 *     ARCHIVES one an order or the stock history names; an archived row frees
 *     its SKU and its option slot for re-use and leaves every list;
 *   - POST /variants/bulk adds many rows whole or not at all, with a dry run.
 * Also the per-photo colour (PATCH /images/:imageId) and the public
 * `color_images` map it feeds.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const ProductVariant = require('../../server/models/ProductVariant');
const Order   = require('../../server/models/Order');
const { getTestSessionCookie, createTestRegularUser, cleanTables } = require('../helpers');

const SLUG = 'l6c-var-';
let adminCookie, userCookie, tee, blk, red;
const base = (pid) => `/api/v1/admin/shop/products/${pid}/variants`;

async function sell(productId, variantId) {
  await Order.createWithItems({
    guestEmail: 'l6c-var@example.com', guestName: 'L6c', currency: 'ISK',
    shippingMethod: 'local_pickup', shippingAddress: null, shipping: 0,
    items: [{ productId, variantId, quantity: 1, price: 1590, name: 'Tee' }],
  });
}

beforeEach(async () => {
  await cleanTables();
  await db.query(`DELETE FROM orders WHERE guest_email = 'l6c-var@example.com'`);
  await db.query(`DELETE FROM products WHERE slug LIKE '${SLUG}%'`);
  adminCookie = await getTestSessionCookie();
  userCookie  = await getTestSessionCookie(await createTestRegularUser());
  tee = await Product.create({ slug: SLUG + 'tee', name: 'L6c Tee', price_isk: 1590, price_eur: 1100, category: 'product', variant_axes: ['color', 'size'], active: true });
  blk = await ProductVariant.create({ product_id: tee.id, sku: 'L6C-BLK-M', attributes: { color: 'Black', size: 'M' } });
  red = await ProductVariant.create({ product_id: tee.id, sku: 'L6C-RED-M', attributes: { color: 'Red', size: 'M' } });
});

afterAll(async () => {
  await db.query(`DELETE FROM orders WHERE guest_email = 'l6c-var@example.com'`);
  await db.query(`DELETE FROM products WHERE slug LIKE '${SLUG}%'`);
});

describe('POST /products/:id/variants', () => {
  test('keeps the barcode and the shelf it used to drop', async () => {
    const res = await request(app).post(base(tee.id)).set('Cookie', adminCookie)
      .send({ sku: 'L6C-BLU-M', attributes: { color: 'Blue', size: 'M' }, barcode: '5694312559999', bin: 'A-12' });
    expect(res.status).toBe(201);
    expect(res.body.variant).toMatchObject({ sku: 'L6C-BLU-M', barcode: '5694312559999', bin: 'A-12', archived_at: null });
  });

  test('localised 400s for a missing SKU and bad attributes', async () => {
    const noSku = await request(app).post(base(tee.id)).set('Cookie', adminCookie).set('x-locale', 'is')
      .send({ attributes: { color: 'Blue', size: 'M' } });
    expect(noSku.status).toBe(400);
    expect(noSku.body.error).toMatch(/SKU/);
    const badAttrs = await request(app).post(base(tee.id)).set('Cookie', adminCookie)
      .send({ sku: 'X-1', attributes: { color: '' } });
    expect(badAttrs.status).toBe(400);
    expect(badAttrs.body.code).toBe(400);
  });

  test('403 for a signed-in user without the products view', async () => {
    const res = await request(app).post(base(tee.id)).set('Cookie', userCookie)
      .send({ sku: 'NOPE', attributes: { color: 'Blue', size: 'S' } });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /products/:id/variants/:variantId', () => {
  test('fixes an option value in place', async () => {
    const res = await request(app).patch(`${base(tee.id)}/${blk.id}`).set('Cookie', adminCookie)
      .send({ attributes: { color: 'Black', size: 'L' } });
    expect(res.status).toBe(200);
    expect(res.body.variant.attributes).toEqual({ color: 'Black', size: 'L' });
  });

  test('a collision with a live sibling is a 409', async () => {
    const res = await request(app).patch(`${base(tee.id)}/${blk.id}`).set('Cookie', adminCookie)
      .send({ attributes: { color: 'Red', size: 'M' } });
    expect(res.status).toBe(409);
  });

  test('a variant of another product is not reachable through this one', async () => {
    const other = await Product.create({ slug: SLUG + 'mug', name: 'L6c Mug', price_isk: 900, price_eur: 600, category: 'product', variant_axes: ['color'] });
    const res = await request(app).patch(`${base(other.id)}/${blk.id}`).set('Cookie', adminCookie).send({ sku: 'HIJACK' });
    expect(res.status).toBe(404);
    const del = await request(app).delete(`${base(other.id)}/${blk.id}`).set('Cookie', adminCookie);
    expect(del.status).toBe(404);
    expect((await ProductVariant.findById(blk.id)).sku).toBe('L6C-BLK-M');
  });
});

describe('DELETE /products/:id/variants/:variantId', () => {
  test('a variant nothing names is deleted, and its SKU and size are free again', async () => {
    const res = await request(app).delete(`${base(tee.id)}/${red.id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deleted: true, archived: false });
    expect(await ProductVariant.findById(red.id)).toBeNull();
    const again = await request(app).post(base(tee.id)).set('Cookie', adminCookie)
      .send({ sku: 'L6C-RED-M', attributes: { color: 'Red', size: 'M' } });
    expect(again.status).toBe(201);
  });

  test('a sold variant is archived — out of every list — and its SKU and size can be re-used', async () => {
    await sell(tee.id, red.id);
    const res = await request(app).delete(`${base(tee.id)}/${red.id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deleted: false, archived: true });
    expect(res.body.message).toBeTruthy();
    const row = await ProductVariant.findById(red.id);
    expect(row.archived_at).not.toBeNull();
    expect(row.active).toBe(false);

    const list = await request(app).get(base(tee.id)).set('Cookie', adminCookie);
    expect(list.body.variants.map(v => v.id)).not.toContain(red.id);

    // The whole point: the SKU and the option combination are free again.
    const again = await request(app).post(base(tee.id)).set('Cookie', adminCookie)
      .send({ sku: 'L6C-RED-M', attributes: { color: 'Red', size: 'M' } });
    expect(again.status).toBe(201);
    expect((await ProductVariant.findBySku('L6C-RED-M')).id).toBe(again.body.variant.id);
    // A second delete of the archived row answers 404, not a second archive.
    expect((await request(app).delete(`${base(tee.id)}/${red.id}`).set('Cookie', adminCookie)).status).toBe(404);
  });

  test('a never-sold variant with stock history is archived, keeping the audit trail', async () => {
    const stocked = await ProductVariant.create({ product_id: tee.id, sku: 'L6C-BLK-S', attributes: { color: 'Black', size: 'S' }, stock: 5 });
    const res = await request(app).delete(`${base(tee.id)}/${stocked.id}`).set('Cookie', adminCookie);
    expect(res.body).toMatchObject({ archived: true });
    const { rows } = await db.query('SELECT reason FROM inventory_adjustments WHERE product_variant_id = $1', [stocked.id]);
    expect(rows).toEqual([{ reason: 'opening' }]);
  });
});

describe('POST /products/:id/variants/bulk', () => {
  const colour = (color, skus) => ['S', 'L'].map((size, i) => ({ attributes: { color, size }, sku: skus[i], barcode: `50550000000${i}${color.length}` }));

  test('a dry run writes nothing; the real run creates every row at stock 0', async () => {
    const rows = colour('Navy', ['L6C-NVY-S', 'L6C-NVY-L']);
    const dry = await request(app).post(`${base(tee.id)}/bulk`).set('Cookie', adminCookie).send({ variants: rows, dry_run: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dry_run: true });
    expect(dry.body.variants).toHaveLength(2);
    expect(await ProductVariant.findBySku('L6C-NVY-S')).toBeNull();

    const res = await request(app).post(`${base(tee.id)}/bulk`).set('Cookie', adminCookie).send({ variants: rows });
    expect(res.status).toBe(201);
    expect(res.body.variants.map(v => [v.sku, v.stock, v.active])).toEqual([['L6C-NVY-S', 0, true], ['L6C-NVY-L', 0, true]]);
  });

  test('all or nothing: one taken SKU refuses the whole batch and names the row', async () => {
    const rows = colour('Navy', ['L6C-NVY-S', 'l6c-blk-m']); // case-blind clash with a live SKU
    const res = await request(app).post(`${base(tee.id)}/bulk`).set('Cookie', adminCookie).send({ variants: rows });
    expect(res.status).toBe(409);
    expect(res.body.errors).toEqual([expect.objectContaining({ index: 1, field: 'sku', reason: 'sku_taken' })]);
    expect(await ProductVariant.findBySku('L6C-NVY-S')).toBeNull();
  });

  test('every list problem comes back at once, as a 400, in the reader\'s language', async () => {
    const res = await request(app).post(`${base(tee.id)}/bulk`).set('Cookie', adminCookie).set('x-locale', 'is')
      .send({ variants: [
        { attributes: { color: 'Black', size: 'M' }, sku: 'L6C-DUP' },       // exists (folded)
        { attributes: { colour: 'Navy', size: 'S' }, sku: 'L6C-N1' },         // unknown axis + missing
        { attributes: { color: 'Navy', size: 'S' } },                         // no SKU
      ] });
    expect(res.status).toBe(400);
    const reasons = res.body.errors.map(e => `${e.index}:${e.reason}`);
    expect(reasons).toEqual(expect.arrayContaining(['0:exists', '1:unknown_axis', '1:missing_axis', '2:sku_required']));
    expect(res.body.error).toMatch(/Lína 1/);
  });

  test('an archived variant\'s SKU is free for the batch too (one rule with the single route)', async () => {
    await sell(tee.id, red.id);
    await request(app).delete(`${base(tee.id)}/${red.id}`).set('Cookie', adminCookie);
    const res = await request(app).post(`${base(tee.id)}/bulk`).set('Cookie', adminCookie)
      .send({ variants: [{ attributes: { color: 'Red', size: 'M' }, sku: 'L6C-RED-M' }] });
    expect(res.status).toBe(201);
  });

  test('a product with no options is refused', async () => {
    const plain = await Product.create({ slug: SLUG + 'plain', name: 'L6c Plain', price_isk: 500, price_eur: 300, category: 'product' });
    const res = await request(app).post(`${base(plain.id)}/bulk`).set('Cookie', adminCookie)
      .send({ variants: [{ attributes: { color: 'Red' }, sku: 'L6C-PLAIN-R' }] });
    expect(res.status).toBe(400);
    expect(res.body.errors[0]).toMatchObject({ reason: 'no_axes' });
  });

  test('404 for an unknown product, 403 without the products view', async () => {
    expect((await request(app).post(`${base('nope')}/bulk`).set('Cookie', adminCookie).send({ variants: [] })).status).toBe(404);
    expect((await request(app).post(`${base(tee.id)}/bulk`).set('Cookie', userCookie).send({ variants: [] })).status).toBe(403);
  });
});

describe('the per-photo colour', () => {
  async function image(url, color = null) {
    const img = await Product.addImage(tee.id, { url });
    return color ? Product.updateImageColor(tee.id, img.id, color) : img;
  }

  test('PATCH stores the folded tag; null clears it; another product\'s URL is a 404', async () => {
    const img = await image('/assets/products/l6c/navy.jpg');
    const res = await request(app).patch(`/api/v1/admin/shop/products/${tee.id}/images/${img.id}`).set('Cookie', adminCookie)
      .send({ color: 'French Navy (FRNA)' });
    expect(res.status).toBe(200);
    expect(res.body.image.color).toBe('french-navy');
    const cleared = await request(app).patch(`/api/v1/admin/shop/products/${tee.id}/images/${img.id}`).set('Cookie', adminCookie).send({ color: null });
    expect(cleared.body.image.color).toBeNull();
    expect((await request(app).patch(`/api/v1/admin/shop/products/${tee.id}/images/${img.id}`).set('Cookie', adminCookie).send({})).status).toBe(400);
    const other = await Product.create({ slug: SLUG + 'other', name: 'L6c Other', price_isk: 1, price_eur: 1, category: 'product' });
    expect((await request(app).patch(`/api/v1/admin/shop/products/${other.id}/images/${img.id}`).set('Cookie', adminCookie).send({ color: 'red' })).status).toBe(404);
  });

  test('the public product carries color_images, matched on the server (containment included)', async () => {
    await ProductVariant.update(red.id, { attributes: { color: 'French Navy (FRNA)', size: 'M' } });
    const plain = await image('/assets/products/l6c/plain.jpg');
    const black = await image('/assets/products/l6c/black.jpg', 'black');
    const navy  = await image('/assets/products/l6c/navy.jpg', 'navy');
    const res = await request(app).get(`/api/v1/shop/products/${tee.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.product.color_images).toEqual({ black: black.id, 'french-navy': navy.id });
    expect(res.body.product.images.map(i => i.id)).toContain(plain.id);
  });
});

