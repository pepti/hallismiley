'use strict';

/**
 * Products → Duplicates and the merge (migration 120; ported from
 * icelandicstore #309/#311/#312/#315, harvest 2 lane 6b). Pins:
 *  - the gate (staff with the products view only) and the read-only suggestions;
 *  - ONE transaction moves variants, images, collection links and order lines,
 *    moves stock only through Inventory (merge_out/merge_in, net zero, audited),
 *    and leaves ISSUED invoice lines alone (draft ones follow);
 *  - the merged product is inactive with merged_into_id, frozen for writes, and
 *    its API + SSR URLs answer 301 to the survivor;
 *  - merging into itself, a stale preview and a refusal write nothing;
 *  - concurrency: a held order lock → MERGE_BUSY; a checkout that holds the
 *    source's KEY SHARE commits first and its line is repointed; a checkout
 *    AFTER the merge is refused (lock order, no deadlock);
 *  - the FK coverage guard, both ways.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const ProductVariant = require('../../server/models/ProductVariant');
const ProductMerge = require('../../server/models/ProductMerge');
const Order   = require('../../server/models/Order');
const Inventory = require('../../server/models/Inventory');
const mergeEngine = require('../../server/services/productMerge/engine');
const { coverage } = require('../../server/services/productMerge/repointSpec');
const { getTestSessionCookie, cleanTables, createTestRegularUser } = require('../helpers');

const SLUG = 'pm-';
let adminCookie, adminId, userCookie;
let invoiceNo = 910000;

async function mkProduct(slug, extra = {}) {
  return Product.create({ slug: SLUG + slug, name: `Merge ${slug}`, price_isk: 1000, price_eur: 700, category: 'product', ...extra });
}
async function mkVariant(product, sku, attributes, extra = {}) {
  return ProductVariant.create({ product_id: product.id, sku, attributes, ...extra });
}
async function mkOrder(items, { paid = true } = {}) {
  const order = await Order.createWithItems({
    guestEmail: 'pm@example.com', guestName: 'Merge Test', currency: 'ISK',
    shippingMethod: 'local_pickup', shippingAddress: null, shipping: 0,
    items: items.map(i => ({ price: 1000, name: 'x', ...i })),
  });
  if (paid) await Order.setOrderStatuses(order.id, { payment_status: 'paid' });
  return order;
}
async function mkInvoiceLine(productId, { issued }) {
  invoiceNo += 1;
  const { rows } = await db.query(
    `INSERT INTO invoices (series, invoice_number, seller_name, seller_kennitala, seller_vat_number,
        customer_name, issued_at, due_at, subtotal_net, vat_total, total_gross, status, created_by)
     VALUES ('invoice', $1, 'Seljandi ehf.', '1203894599', '148820', 'Kaupandi', now(), now() + INTERVAL '14 days',
             806, 194, 1000, 'draft', $2) RETURNING id`, [invoiceNo, adminId]);
  const invoiceId = rows[0].id;
  const { rows: l } = await db.query(
    `INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price_gross, vat_rate,
        gross_before_discount, line_net, line_vat, line_gross, revenue_account)
     VALUES ($1, $2, 'Vara', 1, 1000, 24, 1000, 806, 194, 1000, '3000') RETURNING id`, [invoiceId, productId]);
  if (issued) await db.query(`UPDATE invoices SET status = 'issued' WHERE id = $1`, [invoiceId]);
  return l[0].id;
}
async function ledger(productIds) {
  const { rows } = await db.query(
    `SELECT product_id, product_variant_id, previous_stock, new_stock, delta, reason, user_id
       FROM inventory_adjustments WHERE product_id = ANY($1::text[]) AND reason LIKE 'merge%'
      ORDER BY created_at, id`, [productIds]);
  return rows;
}
async function preview(body) {
  return request(app).post('/api/v1/admin/shop/products/merge/preview').set('Cookie', adminCookie).send(body);
}
async function merge(body) {
  return request(app).post('/api/v1/admin/shop/products/merge').set('Cookie', adminCookie).send(body);
}
// Preview with the proposal, then apply exactly what the preview planned.
async function previewAndMerge(master, ids) {
  const p = await preview({ master, ids });
  expect(p.status).toBe(200);
  return merge({ ...p.body.request, expect: p.body.expect });
}

beforeAll(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();
  const { rows } = await db.query('SELECT user_id FROM user_sessions LIMIT 1');
  adminId = rows[0].user_id;
  const uid = await createTestRegularUser();
  userCookie = await getTestSessionCookie(uid);
});

afterAll(async () => {
  await db.query(`DELETE FROM orders WHERE guest_email = 'pm@example.com'`);
});

describe('gate', () => {
  test('anonymous 401, a user without the products view 403, staff 200 with groups', async () => {
    expect((await request(app).get('/api/v1/admin/shop/products/duplicates')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/shop/products/duplicates').set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/shop/products/merge').set('Cookie', userCookie).send({})).status).toBe(403);
    const res = await request(app).get('/api/v1/admin/shop/products/duplicates').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.groups)).toBe(true);
  });
});

describe('the merge itself is admin-only (products-view staff may look and preview)', () => {
  let staffCookie;
  beforeAll(async () => {
    await db.query(
      `INSERT INTO roles (name, description, view_access, is_system) VALUES ('pm_products', 'productMerge test', '["products"]'::jsonb, FALSE)
       ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`);
    require('../../server/models/Role').invalidateCache();
    await db.query(
      `INSERT INTO users (id, email, username, role, approval_status, email_verified)
       VALUES ('pm-staff-id', 'pm-staff@test.com', 'pmstaff', 'pm_products', 'approved', TRUE) ON CONFLICT (id) DO NOTHING`);
    staffCookie = await getTestSessionCookie('pm-staff-id');
  });

  test('products-view staff: 200 on the suggestions and the preview, 403 merge_admin_only on the merge; admin: 200', async () => {
    const m = await mkProduct('gate-m', { stock: 1 });
    const s = await mkProduct('gate-s', { stock: 2 });
    expect((await request(app).get('/api/v1/admin/shop/products/duplicates').set('Cookie', staffCookie)).status).toBe(200);
    const p = await request(app).post('/api/v1/admin/shop/products/merge/preview').set('Cookie', staffCookie).send({ master: m.id, ids: [s.id] });
    expect(p.status).toBe(200);
    const denied = await request(app).post('/api/v1/admin/shop/products/merge').set('Cookie', staffCookie)
      .send({ ...p.body.request, expect: p.body.expect });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 403, reason: 'merge_admin_only', error: expect.any(String) });
    expect((await Product.findById(s.id)).active).toBe(true);
    const ok = await merge({ ...p.body.request, expect: p.body.expect });
    expect(ok.status).toBe(200);
    expect(ok.body.merged).toEqual([s.id]);
  });
});

describe('suggestions', () => {
  test('a shared barcode forms one group with the evidence, and the request writes nothing', async () => {
    const a = await mkProduct('dup-a', { name: 'Lopapeysa Hekla', barcode: '5690000000015', stock: 2 });
    const b = await mkProduct('dup-b', { name: 'Hekla lopapeysa grá', barcode: '5690000000015', stock: 1 });
    const before = await db.query('SELECT COUNT(*)::int AS n FROM inventory_adjustments');
    const res = await request(app).get('/api/v1/admin/shop/products/duplicates').set('Cookie', adminCookie);
    const group = res.body.groups.find(g => g.products.some(p => p.id === a.id));
    expect(group).toBeTruthy();
    expect(group.signals).toContain('barcode');
    expect(group.products.map(p => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(group.products[0]).toEqual(expect.objectContaining({
      on_hand: expect.any(Number), order_lines: 0, image_count: 0, collection_count: 0, variant_count: 0,
    }));
    const after = await db.query('SELECT COUNT(*)::int AS n FROM inventory_adjustments');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('refusals write nothing', () => {
  test('merging a product into itself is a 400 before anything is read', async () => {
    const a = await mkProduct('self');
    const res = await merge({ master: a.id, ids: [a.id], variant_map: [], expect: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 400, reason: 'master_in_sources' });
    expect((await preview({ master: a.id, ids: [a.id] })).status).toBe(400);
  });

  test('a VAT mismatch is refused (409 merge_refused), a stale preview is 409 stale_preview', async () => {
    const m = await mkProduct('vat-m', { stock: 1 });
    const s = await mkProduct('vat-s', { stock: 1, vat_rate: 11 });
    const p = await preview({ master: m.id, ids: [s.id] });
    expect(p.body.plan.ok).toBe(false);
    expect(p.body.plan.refusals.map(r => r.code)).toContain('vat_mismatch');
    const res = await merge({ ...p.body.request, expect: p.body.expect });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('merge_refused');

    const m2 = await mkProduct('stale-m', { stock: 1 });
    const s2 = await mkProduct('stale-s', { stock: 4 });
    const p2 = await preview({ master: m2.id, ids: [s2.id] });
    await Product.update(s2.id, { stock: 5 }, { userId: adminId });
    const stale = await merge({ ...p2.body.request, expect: p2.body.expect });
    expect(stale.status).toBe(409);
    expect(stale.body.reason).toBe('stale_preview');
    expect((await Product.findById(s2.id)).active).toBe(true);
    expect(await ledger([m2.id, s2.id])).toEqual([]);
  });
});

describe('simple into simple', () => {
  let m, s, coll1, coll2, lineOrder, draftLine, issuedLine, receiptId;
  beforeAll(async () => {
    m = await mkProduct('ss-m', { stock: 3, sku: 'SS-M' });
    s = await mkProduct('ss-s', { stock: 5, sku: 'SS-S', barcode: '5690000000022', description: '' });
    await Product.addImage(m.id, { url: '/uploads/products/pm-m.webp' });
    await Product.addImage(s.id, { url: '/uploads/products/pm-s.webp' });
    await Product.addImage(s.id, { url: '/uploads/products/pm-m.webp' }); // same picture twice: not duplicated
    const c = await db.query(`INSERT INTO collections (slug, title) VALUES ('pm-c1','C1'),('pm-c2','C2') RETURNING id`);
    [coll1, coll2] = c.rows.map(r => r.id);
    await db.query(`INSERT INTO product_collections (product_id, collection_id) VALUES ($1,$3),($2,$3),($2,$4)`, [m.id, s.id, coll1, coll2]);
    lineOrder = await mkOrder([{ productId: s.id, quantity: 2 }]); // paid, not fulfilled: commits 2
    draftLine = await mkInvoiceLine(s.id, { issued: false });
    issuedLine = await mkInvoiceLine(s.id, { issued: true });
    const { rows: gr } = await db.query(`INSERT INTO goods_receipts (supplier_name) VALUES ('PM birgir') RETURNING id`);
    receiptId = gr[0].id;
    await db.query(`INSERT INTO goods_receipt_lines (receipt_id, product_id, expected_qty) VALUES ($1, $2, 4)`, [receiptId, s.id]);
    await db.query(`INSERT INTO goods_receipt_scans (receipt_id, product_id, scanned_code) VALUES ($1, $2, 'SS-S')`, [receiptId, s.id]);
  });

  test('one merge moves stock through the ledger, images, collections, order lines and draft invoice lines', async () => {
    const res = await previewAndMerge(m.id, [s.id]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ masterId: m.id, merged: [s.id], shape: 'simple', stockMode: 'move' });

    // stock: 3 + 5 on the survivor, the source at 0, net-zero audited pair
    expect((await Product.findById(m.id)).stock).toBe(8);
    const src = await Product.findById(s.id);
    expect(src).toMatchObject({ stock: 0, active: false, sku: null, barcode: null });
    const rows = await ledger([m.id, s.id]);
    expect(rows.map(r => [r.product_id, r.reason, r.delta]).sort()).toEqual([[m.id, 'merge_in', 5], [s.id, 'merge_out', -5]].sort());
    expect(rows.every(r => r.user_id === adminId)).toBe(true);
    expect(rows.reduce((n, r) => n + r.delta, 0)).toBe(0);

    const { rows: [pm] } = await db.query('SELECT merged_into_id FROM products WHERE id = $1', [s.id]);
    expect(pm.merged_into_id).toBe(m.id);
    // the survivor took the barcode it lacked
    expect((await Product.findById(m.id)).barcode).toBe('5690000000022');

    // images: the new one after the survivor's own; the duplicate URL stays behind
    const imgs = await Product.listImages(m.id);
    expect(imgs.map(i => i.url)).toEqual(['/uploads/products/pm-m.webp', '/uploads/products/pm-s.webp']);
    // collections: C1 deduped, C2 followed
    const { rows: pc } = await db.query('SELECT product_id, collection_id FROM product_collections WHERE collection_id = ANY($1) ORDER BY collection_id', [[coll1, coll2]]);
    expect(pc.every(r => r.product_id === m.id)).toBe(true);
    expect(pc).toHaveLength(2);
    // order lines follow — Committed follows the stock
    const { rows: oi } = await db.query('SELECT product_id FROM order_items WHERE order_id = $1', [lineOrder.id]);
    expect(oi.map(r => r.product_id)).toEqual([m.id]);
    const deco = await Inventory.decorate(await Product.findById(m.id));
    expect(deco).toMatchObject({ on_hand: 8, committed: 2, available: 6 });
    // books: the draft line follows, the ISSUED line never changes
    const { rows: il } = await db.query('SELECT id, product_id FROM invoice_lines WHERE id = ANY($1)', [[draftLine, issuedLine]]);
    const byId = Object.fromEntries(il.map(r => [r.id, r.product_id]));
    expect(byId[draftLine]).toBe(m.id);
    expect(byId[issuedLine]).toBe(s.id);
    // a draft goods receipt's line and scan follow (migration 118)
    const { rows: grl } = await db.query(
      `SELECT product_id FROM goods_receipt_lines WHERE receipt_id = $1
       UNION ALL SELECT product_id FROM goods_receipt_scans WHERE receipt_id = $1`, [receiptId]);
    expect(grl.map(r => r.product_id)).toEqual([m.id, m.id]);

    // the log + the staff audit row
    const log = await db.query('SELECT master_id, merged_id, merged_sku, merged_slug, stock_moved, merged_by FROM product_merges WHERE merged_id = $1', [s.id]);
    expect(log.rows[0]).toMatchObject({ master_id: m.id, merged_sku: 'SS-S', merged_slug: `${SLUG}ss-s`, stock_moved: 5, merged_by: adminId });
    const audit = await db.query(`SELECT entity_id, summary FROM staff_audit_log WHERE action = 'product.merged' AND entity_id = $1`, [m.id]);
    expect(audit.rows[0].summary.merged).toEqual([s.id]);
  });

  test('the merged product is hidden from the admin list and frozen for writes', async () => {
    const list = await request(app).get('/api/v1/admin/shop/products').set('Cookie', adminCookie);
    expect(list.body.products.some(p => p.id === s.id)).toBe(false);
    const patch = await request(app).patch(`/api/v1/admin/shop/products/${s.id}`).set('Cookie', adminCookie).send({ stock: 9 });
    expect(patch.status).toBe(409);
    expect(patch.body).toMatchObject({ reason: 'product_merged', movedTo: { id: m.id } });
    const again = await previewAndMerge(m.id, [s.id]);
    expect(again.status).toBe(409);
    expect(again.body.refusals.map(r => r.code)).toContain('already_merged');
  });

  test('the freeze holds below the routes too: the model refuses (MCP, import), bulk edit skips', async () => {
    await expect(Product.update(s.id, { name: 'x' })).rejects.toMatchObject({ status: 409, reason: 'product_merged', movedTo: { id: m.id } });
    await expect(Product.update(s.id, { stock: 4 }, { userId: adminId })).rejects.toMatchObject({ reason: 'product_merged' });
    const bulk = await request(app).post('/api/v1/admin/shop/products/bulk').set('Cookie', adminCookie)
      .send({ ids: [s.id, m.id], action: 'edit', fields: { bin: 'Z9' } });
    expect(bulk.status).toBe(200);
    expect((await Product.findById(s.id)).bin).not.toBe('Z9');
    expect((await Product.findById(m.id)).bin).toBe('Z9');
  });

  test('its API and SSR URLs answer 301 to the survivor, never cached', async () => {
    const api = await request(app).get(`/api/v1/shop/products/${SLUG}ss-s`);
    expect(api.status).toBe(301);
    expect(api.headers.location).toBe(`/api/v1/shop/products/${SLUG}ss-m`);
    expect(api.headers['cache-control']).toBe('no-store');
    for (const prefix of ['', '/en', '/is']) {
      const page = await request(app).get(`${prefix}/shop/${SLUG}ss-s?ref=x`).set('Accept', 'text/html');
      expect(page.status).toBe(301);
      expect(page.headers.location).toBe(`${prefix}/shop/${SLUG}ss-m?ref=x`);
      expect(page.headers['cache-control']).toBe('no-store');
    }
    // the survivor switched off → no redirect to a page that is not there
    await Product.update(m.id, { active: false });
    expect((await request(app).get(`/api/v1/shop/products/${SLUG}ss-s`)).status).toBe(404);
    await Product.update(m.id, { active: true });
  });

  test('a checkout AFTER the merge that still names the source is refused (409 PRODUCT_MERGED)', async () => {
    await expect(mkOrder([{ productId: s.id, quantity: 1 }], { paid: false }))
      .rejects.toMatchObject({ status: 409, reason: 'PRODUCT_MERGED' });
  });
});

describe('variants into variants', () => {
  let m, s, mRedS, sRedS, sRedM, order, sM;
  beforeAll(async () => {
    m = await mkProduct('vv-m', { name: 'Tee | Classic', variant_axes: ['color', 'size'] });
    mRedS = await mkVariant(m, 'VV-M-RED-S', { color: 'Red', size: 'S' }, { stock: 2 });
    await mkVariant(m, 'VV-M-BLK-S', { color: 'Black', size: 'S' }, { stock: 1 });
    s = await mkProduct('vv-s', { name: 'Tee | Classic | Red', variant_axes: ['size'] });
    sRedS = await mkVariant(s, 'VV-S-S', { size: 'S' }, { stock: 4, barcode: '5690000000039' });
    sRedM = await mkVariant(s, 'VV-S-M', { size: 'M' }, { stock: 3 });
    sM = sRedM;
    order = await mkOrder([{ productId: s.id, variantId: sRedS.id, quantity: 1 }]);
  });

  test('the proposal maps S onto the survivor\'s Red/S and moves M as a new Red/M; stock balances', async () => {
    const p = await preview({ master: m.id, ids: [s.id] });
    expect(p.body.plan.ok).toBe(true);
    const kinds = Object.fromEntries(p.body.plan.units.map(u => [u.variantId, u.kind]));
    expect(kinds).toEqual({ [sRedS.id]: 'map', [sRedM.id]: 'move' });
    const totalBefore = 2 + 1 + 4 + 3;
    const res = await merge({ ...p.body.request, expect: p.body.expect });
    expect(res.status).toBe(200);

    const vs = await ProductVariant.listForProduct(m.id, { activeOnly: false });
    const bySku = Object.fromEntries(vs.map(v => [v.sku, v]));
    expect(bySku['VV-M-RED-S'].stock).toBe(6);               // 2 + 4 mapped
    expect(bySku['VV-M-RED-S'].barcode).toBe('5690000000039'); // handed over
    expect(bySku['VV-S-M']).toMatchObject({ stock: 3, product_id: m.id });   // moved row keeps id, sku, stock
    expect(bySku['VV-S-M'].attributes).toEqual({ color: 'Red', size: 'M' });
    const src = await ProductVariant.listForProduct(s.id, { activeOnly: false });
    expect(src).toEqual([expect.objectContaining({ id: sRedS.id, active: false, stock: 0, barcode: null })]);
    const total = vs.reduce((n, v) => n + v.stock, 0) + src.reduce((n, v) => n + v.stock, 0);
    expect(total).toBe(totalBefore);

    const rows = await ledger([m.id, s.id]);
    expect(rows.map(r => [r.product_variant_id, r.reason, r.delta])).toEqual(expect.arrayContaining([
      [sRedS.id, 'merge_out', -4], [mRedS.id, 'merge_in', 4], [sM.id, 'merge', 0],
    ]));
    expect(rows.reduce((n, r) => n + r.delta, 0)).toBe(0);

    // the open order line follows its unit to the survivor's row
    const { rows: oi } = await db.query('SELECT product_id, product_variant_id FROM order_items WHERE order_id = $1', [order.id]);
    expect(oi[0]).toEqual({ product_id: m.id, product_variant_id: mRedS.id });
  });

  test('the retired SKU resolves to the live row for the import and the scanner', async () => {
    const hit = (await Product.findForImport(['VV-S-S'])).get('VV-S-S');
    expect(hit).toMatchObject({ kind: 'variant', variantId: mRedS.id });
    const scan = await Product.resolveByCode('VV-S-S');
    expect(scan).toMatchObject({ variantId: mRedS.id, productId: m.id });
  });

  test('a variant left on the merged product is frozen with it (MCP set_stock goes through here)', async () => {
    await expect(ProductVariant.update(sRedS.id, { stock: 9 }, { userId: adminId })).rejects.toMatchObject({ reason: 'product_merged' });
    // the moved row belongs to the survivor now and stays editable
    await expect(ProductVariant.update(sM.id, { bin: 'B1' })).resolves.toBeTruthy();
  });
});

describe('concurrency (lock order)', () => {
  test('an order row held by another transaction makes the merge MERGE_BUSY, and nothing is written', async () => {
    const m = await mkProduct('busy-m', { stock: 1 });
    const s = await mkProduct('busy-s', { stock: 2 });
    const order = await mkOrder([{ productId: s.id, quantity: 1 }]);
    const p = await mergeEngine.preview({ master: m.id, ids: [s.id] });
    const holder = await db.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [order.id]);
      await expect(mergeEngine.apply({ ...p.request, expect: p.expect }, { userId: adminId, lockTimeoutMs: 300 }))
        .rejects.toMatchObject({ code: 'MERGE_BUSY' });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    expect((await Product.findById(s.id)).active).toBe(true);
    const res = await request(app).post('/api/v1/admin/shop/products/merge').set('Cookie', adminCookie)
      .send({ ...p.request, expect: 'not-the-token' });
    expect(res.status).toBe(409);
  });

  test('a draft goods receipt being finalised (its row held) makes the merge MERGE_BUSY', async () => {
    const m = await mkProduct('grbusy-m', { stock: 1 });
    const s = await mkProduct('grbusy-s', { stock: 2 });
    const { rows: gr } = await db.query(`INSERT INTO goods_receipts (supplier_name) VALUES ('PM') RETURNING id`);
    await db.query(`INSERT INTO goods_receipt_lines (receipt_id, product_id, expected_qty) VALUES ($1, $2, 1)`, [gr[0].id, s.id]);
    const p = await mergeEngine.preview({ master: m.id, ids: [s.id] });
    const holder = await db.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM goods_receipts WHERE id = $1 FOR UPDATE', [gr[0].id]);
      await expect(mergeEngine.apply({ ...p.request, expect: p.expect }, { userId: adminId, lockTimeoutMs: 300 }))
        .rejects.toMatchObject({ code: 'MERGE_BUSY' });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    expect((await Product.findById(s.id)).active).toBe(true);
  });

  test('a checkout holding the source\'s KEY SHARE commits first; the merge then repoints its line', async () => {
    const m = await mkProduct('race-m', { stock: 1 });
    const s = await mkProduct('race-s', { stock: 3 });
    const p = await mergeEngine.preview({ master: m.id, ids: [s.id] });
    const checkout = await db.pool.connect();
    let orderId;
    try {
      await checkout.query('BEGIN');
      const { rows } = await checkout.query(
        `INSERT INTO orders (order_number, guest_email, guest_name, currency, subtotal, shipping, total, status, shipping_method)
         VALUES ('PM-RACE-1', 'pm@example.com', 'Race', 'ISK', 1000, 0, 1000, 'pending', 'local_pickup') RETURNING id`);
      orderId = rows[0].id;
      await Inventory.lockReferences(checkout, [{ productId: s.id }]);
      const merging = mergeEngine.apply({ ...p.request, expect: p.expect }, { userId: adminId, lockTimeoutMs: 5000 });
      await new Promise(r => setTimeout(r, 250)); // the merge is now waiting on our KEY SHARE
      await checkout.query(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_snapshot, quantity, currency)
         VALUES ($1, $2, 'x', 1000, 1, 'ISK')`, [orderId, s.id]);
      await checkout.query('COMMIT');
      const result = await merging;
      expect(result.merged).toEqual([s.id]);
    } finally {
      checkout.release();
    }
    const { rows: oi } = await db.query('SELECT product_id FROM order_items WHERE order_id = $1', [orderId]);
    expect(oi[0].product_id).toBe(m.id);
    expect((await Product.findById(m.id)).stock).toBe(4);
  });
});

describe('the FK coverage guard', () => {
  test('repointSpec names every FK to products/variants and nothing that is gone', async () => {
    ProductMerge._resetFkCache();
    const { missing, stale } = coverage(await ProductMerge.productForeignKeys());
    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });

  test('a new FK with no policy switches merging off (503 schema_drift) rather than leave rows behind', async () => {
    const m = await mkProduct('drift-m');
    const s = await mkProduct('drift-s');
    const p = await mergeEngine.preview({ master: m.id, ids: [s.id] });
    await db.query('CREATE TABLE pm_drift_probe (id serial PRIMARY KEY, product_id TEXT REFERENCES products(id))');
    ProductMerge._resetFkCache();
    try {
      const res = await merge({ ...p.request, expect: p.expect });
      expect(res.status).toBe(503);
      expect(res.body.reason).toBe('schema_drift');
      expect((await Product.findById(s.id)).active).toBe(true);
    } finally {
      await db.query('DROP TABLE pm_drift_probe');
      ProductMerge._resetFkCache();
    }
  });
});
