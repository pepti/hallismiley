'use strict';

/**
 * Goods receiving (harvest2-lane6a-2026-09-26; ported from icelandicstore
 * #23). Pins the whole flow and its money path: ingest a supplier file through
 * the shared product-file reader (CSV and .xlsx), match by OUR code only,
 * scan in, read shorts / overs / not-on-invoice, finalise as ONE audited
 * stock batch by what was RECEIVED — and never twice.
 */
const request = require('supertest');
const ExcelJS = require('exceljs');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const ProductVariant = require('../../server/models/ProductVariant');
const GoodsReceipt = require('../../server/models/GoodsReceipt');
const Role    = require('../../server/models/Role');
const {
  getTestSessionCookie, cleanTables, createTestAdminUser, createTestRegularUser,
} = require('../helpers');

const SLUG = 'l6a-gr-';
const BASE = '/api/v1/admin/receiving';
let adminCookie, adminId, userCookie, rcvCookie, invCookie;
let mug, cap, tee, teeS, teeM, ghost;

async function mkProduct(slug, extra = {}) {
  return Product.create({ slug: SLUG + slug, name: `GR ${slug}`, price_isk: 1000, price_eur: 700, category: 'product', ...extra });
}

async function stockOf(productId, variantId = null) {
  const { rows } = variantId
    ? await db.query('SELECT stock FROM product_variants WHERE id = $1', [variantId])
    : await db.query('SELECT stock FROM products WHERE id = $1', [productId]);
  return rows[0].stock;
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

async function newReceipt(cookie = adminCookie, body = {}) {
  const res = await request(app).post(BASE).set('Cookie', cookie)
    .send({ supplierName: 'Acme Wholesale', reference: 'PO-77', ...body });
  expect(res.status).toBe(201);
  return res.body.receipt.id;
}

const CSV = [
  'Item no,EAN,Description,Qty,Unit cost',
  'L6A-GR-MUG,,Ceramic mug 30cl,10,"350,00"',
  ',5690000000031,Cap black,4,900',
  'L6A-GR-TEE-S,,Tee small,5,1200',
  'L6A-GR-TEE,,Tee (no size),3,1200',       // product-level code on a variant product → unmatched
  'NOT-OURS-1,,Something else,2,100',      // unknown code → unmatched
  ',5690000000999,Two rows share this,1,1', // ambiguous barcode → unmatched
].join('\r\n');

function importCsv(id, cookie = adminCookie, csv = CSV) {
  return request(app).post(`${BASE}/${id}/lines/import`).set('Cookie', cookie)
    .attach('file', Buffer.from(csv, 'utf8'), { filename: 'packing-list.csv', contentType: 'text/csv' });
}

function scan(id, code, qty) {
  return request(app).post(`${BASE}/${id}/scan`).set('Cookie', adminCookie).send(qty !== undefined ? { code, qty } : { code });
}

async function adjustmentsFor(receiptId) {
  const { rows } = await db.query(
    `SELECT product_id, product_variant_id, previous_stock, new_stock, delta, reason, note, user_id, batch_id, goods_receipt_id
       FROM inventory_adjustments WHERE goods_receipt_id = $1 ORDER BY created_at, id`, [receiptId]
  );
  return rows;
}

beforeAll(async () => {
  await cleanTables();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie = await getTestSessionCookie(await createTestRegularUser());
  rcvCookie = await roleUser('l6arcv', ['receiving']);
  invCookie = await roleUser('l6ainvonly', ['inventory']);
  mug = await mkProduct('mug', { sku: 'L6A-GR-MUG', stock: 2 });
  cap = await mkProduct('cap', { barcode: '5690000000031', stock: 0 });
  tee = await mkProduct('tee', { sku: 'L6A-GR-TEE', variant_axes: ['size'] });
  teeS = await ProductVariant.create({ product_id: tee.id, sku: 'L6A-GR-TEE-S', attributes: { size: 'S' }, stock: 1 });
  teeM = await ProductVariant.create({ product_id: tee.id, sku: 'L6A-GR-TEE-M', attributes: { size: 'M' }, stock: 0, barcode: '5690000000048' });
  ghost = await mkProduct('ghost', { sku: 'L6A-GR-GHOST', stock: 0 });
  await mkProduct('dup-a', { barcode: '5690000000999' });
  await mkProduct('dup-b', { barcode: '5690000000999' });
});

afterAll(async () => {
  await db.query(`DELETE FROM goods_receipts WHERE supplier_name LIKE 'Acme%' OR supplier_name LIKE 'L6A%'`);
  await db.query(`DELETE FROM products WHERE slug LIKE '${SLUG}%'`);
});

describe('gate + create', () => {
  test('receiving view only: 401, 403 for a customer and for an inventory-only role, 200 for receiving', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).get(BASE).set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).get(BASE).set('Cookie', invCookie)).status).toBe(403);
    expect((await request(app).get(BASE).set('Cookie', rcvCookie)).status).toBe(200);
  });

  test('a supplier name is required; long fields are refused; a draft is created', async () => {
    expect((await request(app).post(BASE).set('Cookie', adminCookie).send({ supplierName: '  ' })).status).toBe(400);
    expect((await request(app).post(BASE).set('Cookie', adminCookie).send({ supplierName: 'L6A x', reference: 'x'.repeat(101) })).status).toBe(400);
    const id = await newReceipt(rcvCookie, { supplierName: 'L6A Draft' });
    const got = await request(app).get(`${BASE}/${id}`).set('Cookie', rcvCookie);
    expect(got.body.receipt).toMatchObject({ status: 'draft', supplier_name: 'L6A Draft', reference: 'PO-77', created_by: 'l6a-l6arcv' });
    expect((await request(app).get(`${BASE}/nope`).set('Cookie', rcvCookie)).status).toBe(404);
  });
});

describe('ingest', () => {
  test('CSV: our code by SKU (variant first) then barcode; unknown, ambiguous and variant-parent codes stay unmatched', async () => {
    const id = await newReceipt();
    const res = await importCsv(id);
    expect(res.status).toBe(200);
    expect(res.body.imported).toMatchObject({ added: 6, matched: 3 });
    const lines = res.body.lines;
    expect(lines.map(l => [l.file_sku || l.barcode, l.product_id, l.variant_id, l.match_status, l.expected_qty])).toEqual([
      ['L6A-GR-MUG', mug.id, null, 'matched', 10],
      ['5690000000031', cap.id, null, 'matched', 4],
      ['L6A-GR-TEE-S', tee.id, teeS.id, 'matched', 5],
      ['L6A-GR-TEE', null, null, 'unmatched', 3],
      ['NOT-OURS-1', null, null, 'unmatched', 2],
      ['5690000000999', null, null, 'unmatched', 1],
    ]);
    expect(lines[0]).toMatchObject({ supplier_description: 'Ceramic mug 30cl', unit_cost: 350 });
    expect(res.body.summary).toMatchObject({ lines: 6, matched: 3, unmatched: 3, expectedUnits: 25, receivedUnits: 0 });
  });

  test('.xlsx through the same reader; an unreadable file is a 400 and adds nothing', async () => {
    const id = await newReceipt();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Invoice');
    ws.addRow(['Vörunúmer', 'Lýsing', 'Magn']);
    ws.addRow(['L6A-GR-TEE-M', 'Bolur M', 6]);
    ws.addRow(['L6A-GR-GHOST', 'Draugur', 1]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await request(app).post(`${BASE}/${id}/lines/import`).set('Cookie', adminCookie)
      .attach('file', buf, { filename: 'invoice.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(200);
    expect(res.body.lines.map(l => [l.variant_id || l.product_id, l.expected_qty])).toEqual([[teeM.id, 6], [ghost.id, 1]]);
    const junk = await request(app).post(`${BASE}/${id}/lines/import`).set('Cookie', adminCookie)
      .attach('file', Buffer.from('PK\u0003\u0004 not really a workbook'), { filename: 'broken.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(junk.status).toBe(400);
    expect((await GoodsReceipt.lines(id))).toHaveLength(2);
  });
});

describe('scan, reconcile, finalise', () => {
  test('the full flow: scans count against lines, extras are not-on-invoice, finalise moves RECEIVED stock once', async () => {
    const id = await newReceipt();
    await importCsv(id);
    const before = { mug: await stockOf(mug.id), cap: await stockOf(cap.id), s: await stockOf(tee.id, teeS.id), m: await stockOf(tee.id, teeM.id), ghost: await stockOf(ghost.id) };

    // Mug: 12 arrive against 10 expected (over). Cap: 3 of 4 (short). Tee S: none.
    expect((await scan(id, 'L6A-GR-MUG', 10)).status).toBe(200);
    const two = await scan(id, 'L6A-GR-MUG', 2);
    expect(two.body.scanned).toMatchObject({ matched: true, qty: 2 });
    await scan(id, '5690000000031');
    await scan(id, '5690000000031');
    const third = await scan(id, '5690000000031');
    // Not on the invoice: tee M (by its own barcode), ghost twice.
    const extra = await scan(id, '5690000000048');
    expect(extra.body.scanned.matched).toBe(false);
    await scan(id, 'L6A-GR-GHOST');
    const g2 = await scan(id, 'L6A-GR-GHOST');
    // Unknown code, and a variant product's own code: 422, nothing recorded.
    expect((await scan(id, 'NOPE-L6A')).status).toBe(422);
    const parent = await scan(id, 'L6A-GR-TEE');
    expect(parent.status).toBe(422);
    expect(parent.body.reason).toBe('VARIANT_REQUIRED');
    // Undo one cap scan, then scan it again: received is re-derived from the log.
    const capScan = third.body.scans.find(s => s.product_id === cap.id);
    const undone = await request(app).delete(`${BASE}/${id}/scans/${capScan.id}`).set('Cookie', adminCookie);
    expect(undone.status).toBe(200);
    await scan(id, '5690000000031');

    const state = (await request(app).get(`${BASE}/${id}`).set('Cookie', adminCookie)).body;
    const byCode = Object.fromEntries(state.lines.map(l => [l.file_sku || l.barcode, l]));
    expect(byCode['L6A-GR-MUG']).toMatchObject({ received_qty: 12, variance: 'over' });
    expect(byCode['5690000000031']).toMatchObject({ received_qty: 3, variance: 'short' });
    expect(byCode['L6A-GR-TEE-S']).toMatchObject({ received_qty: 0, variance: 'not_received' });
    expect(state.extras.map(x => [x.variant_id || x.product_id, x.qty]).sort()).toEqual([[ghost.id, 2], [teeM.id, 1]].sort());
    expect(state.summary).toMatchObject({ short: 2, over: 1, notOnInvoice: 2 });
    expect(g2.status).toBe(200);

    // Unmatched lines block finalise; nothing moves.
    const blocked = await request(app).post(`${BASE}/${id}/finalize`).set('Cookie', adminCookie).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ reason: 'INCOMPLETE' });
    expect(blocked.body.lineIds).toHaveLength(3);
    expect(await stockOf(mug.id)).toBe(before.mug);

    // Resolve: match the variant-parent line to tee M by hand, skip the other two.
    const parentLine = state.lines.find(l => l.file_sku === 'L6A-GR-TEE');
    const matched = await request(app).patch(`${BASE}/${id}/lines/${parentLine.id}`).set('Cookie', adminCookie)
      .send({ productId: tee.id, variantId: teeM.id });
    expect(matched.status).toBe(200);
    // The earlier tee M scan now belongs to that line (it was an extra before).
    const reLine = matched.body.lines.find(l => l.id === parentLine.id);
    expect(reLine).toMatchObject({ match_status: 'manual', variant_id: teeM.id, received_qty: 1 });
    expect(matched.body.extras.map(x => x.product_id)).toEqual([ghost.id]);
    // Matching to a variant product's own row is refused.
    const bad = await request(app).patch(`${BASE}/${id}/lines/${parentLine.id}`).set('Cookie', adminCookie).send({ productId: tee.id });
    expect(bad.status).toBe(409);
    for (const l of state.lines.filter(x => !x.product_id && x.id !== parentLine.id)) {
      const r = await request(app).patch(`${BASE}/${id}/lines/${l.id}`).set('Cookie', adminCookie).send({ matchStatus: 'skipped' });
      expect(r.status).toBe(200);
    }

    // Finalise, leaving the ghost (not on the invoice) OUT of stock.
    const fin = await request(app).post(`${BASE}/${id}/finalize`).set('Cookie', rcvCookie)
      .send({ excludeExtras: [`${ghost.id}|`] });
    expect(fin.status).toBe(200);
    expect(fin.body.receipt).toMatchObject({ status: 'finalized', finalized_by: 'l6a-l6arcv' });
    expect(fin.body.finalized).toMatchObject({ units: 16, lines: 3 });
    expect(await stockOf(mug.id)).toBe(before.mug + 12);          // received, not expected
    expect(await stockOf(cap.id)).toBe(before.cap + 3);
    expect(await stockOf(tee.id, teeS.id)).toBe(before.s);         // nothing arrived
    expect(await stockOf(tee.id, teeM.id)).toBe(before.m + 1);
    expect(await stockOf(ghost.id)).toBe(before.ghost);            // excluded extra

    const ledger = await adjustmentsFor(id);
    expect(ledger).toHaveLength(3);
    expect(new Set(ledger.map(r => r.batch_id)).size).toBe(1);
    expect(fin.body.finalized.batchId).toBe(ledger[0].batch_id);
    for (const r of ledger) {
      expect(r).toMatchObject({ reason: 'receipt', goods_receipt_id: id, user_id: 'l6a-l6arcv', note: 'Acme Wholesale · PO-77' });
      expect(r.delta).toBeGreaterThan(0);
      expect(r.new_stock - r.previous_stock).toBe(r.delta);
    }

    // Idempotent: a second finalise is refused and moves nothing; the receipt is read-only.
    const again = await request(app).post(`${BASE}/${id}/finalize`).set('Cookie', adminCookie).send({});
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('ALREADY_FINALIZED');
    expect(await stockOf(mug.id)).toBe(before.mug + 12);
    expect(await adjustmentsFor(id)).toHaveLength(3);
    expect((await scan(id, 'L6A-GR-MUG')).status).toBe(409);
    expect((await importCsv(id)).status).toBe(409);

    // The receipt prints.
    const pdf = await request(app).get(`${BASE}/${id}/receipt.pdf`).set('Cookie', adminCookie)
      .buffer(true).parse((res, cb) => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('two finalises racing: exactly one moves stock, the other is refused', async () => {
    const id = await newReceipt(adminCookie, { supplierName: 'L6A race' });
    await scan(id, 'L6A-GR-GHOST', 5);
    const before = await stockOf(ghost.id);
    const [a, b] = await Promise.all([
      request(app).post(`${BASE}/${id}/finalize`).set('Cookie', adminCookie).send({}),
      request(app).post(`${BASE}/${id}/finalize`).set('Cookie', adminCookie).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await stockOf(ghost.id)).toBe(before + 5);
    expect(await adjustmentsFor(id)).toHaveLength(1);
  });

  test('cancel: a draft closes without moving stock; a cancelled receipt cannot be finalised or scanned', async () => {
    const id = await newReceipt(adminCookie, { supplierName: 'L6A cancel' });
    await scan(id, 'L6A-GR-GHOST', 3);
    const before = await stockOf(ghost.id);
    const res = await request(app).post(`${BASE}/${id}/cancel`).set('Cookie', adminCookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.receipt.status).toBe('cancelled');
    const fin = await request(app).post(`${BASE}/${id}/finalize`).set('Cookie', adminCookie).send({});
    expect(fin.status).toBe(409);
    expect(fin.body.reason).toBe('RECEIPT_CLOSED');
    expect((await scan(id, 'L6A-GR-GHOST')).status).toBe(409);
    expect(await stockOf(ghost.id)).toBe(before);
  });

  test('body checks: qty per scan, line status, expected qty', async () => {
    const id = await newReceipt(adminCookie, { supplierName: 'L6A checks' });
    await importCsv(id);
    expect((await scan(id, 'L6A-GR-MUG', 0)).status).toBe(400);
    expect((await scan(id, 'L6A-GR-MUG', '2.5')).status).toBe(400);
    expect((await scan(id, '')).status).toBe(400);
    const { lines } = (await request(app).get(`${BASE}/${id}`).set('Cookie', adminCookie)).body;
    const lid = lines[0].id;
    expect((await request(app).patch(`${BASE}/${id}/lines/${lid}`).set('Cookie', adminCookie).send({ matchStatus: 'new_product' })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/${id}/lines/${lid}`).set('Cookie', adminCookie).send({ expectedQty: -1 })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/${id}/lines/${lid}`).set('Cookie', adminCookie).send({})).status).toBe(400);
    const ok = await request(app).patch(`${BASE}/${id}/lines/${lid}`).set('Cookie', adminCookie).send({ expectedQty: 11 });
    expect(ok.body.lines[0].expected_qty).toBe(11);
    expect((await request(app).patch(`${BASE}/${id}/lines/nope`).set('Cookie', adminCookie).send({ expectedQty: 1 })).status).toBe(404);
  });
});
