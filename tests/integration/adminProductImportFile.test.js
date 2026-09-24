'use strict';

/**
 * The products import, server-side (harvested from icelandicstore #249 / #300 /
 * #302 — harvest-ice-d-2026-09-24): one reader for every file
 * (POST /products/import/parse-file — the export's own CSV, a supplier .xlsx,
 * a PDF order), Barcode as the fallback match key (ambiguous or duplicate
 * refused, never guessed), order quantities never read as stock, and rows
 * with a Variant cell creating ONE Draft product with its variants — whole or
 * not at all. Stock moves are audited (reason 'import' / 'opening').
 */
const request = require('supertest');
const ExcelJS = require('exceljs');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const ProductVariant = require('../../server/models/ProductVariant');
const { pdfBuffer } = require('../fixtures/pdfFixture');
const { getTestSessionCookie, cleanTables } = require('../helpers');

const PARSE   = '/api/v1/admin/shop/products/import/parse-file';
const PREVIEW = '/api/v1/admin/shop/products/import/preview';
const APPLY   = '/api/v1/admin/shop/products/import/apply';
const EXPORT  = '/api/v1/admin/shop/products/export.csv';

let adminCookie;

async function xlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const parse = (buf, filename, contentType) => request(app).post(PARSE).set('Cookie', adminCookie)
  .attach('file', buf, { filename, contentType });

beforeAll(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();
  await db.query("DELETE FROM products WHERE slug LIKE 'pif-%' OR name LIKE 'PIF %'");
});

afterAll(async () => {
  await db.query("DELETE FROM products WHERE slug LIKE 'pif-%' OR name LIKE 'PIF %'");
});

describe('POST /products/import/parse-file', () => {
  test('the export\'s own CSV round-trips through the server reader (a quoted line break survives)', async () => {
    const p = await Product.create({ slug: 'pif-csv', name: 'PIF CSV "line\none"', price_isk: 1000, price_eur: 700, stock: 4, sku: 'PIF-CSV-1' });
    const csv = await request(app).get(EXPORT).set('Cookie', adminCookie);
    const res = await parse(Buffer.from(csv.text), 'products.csv', 'text/csv');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('csv');
    const row = res.body.rows.find(r => r.sku === 'PIF-CSV-1');
    expect(row).toMatchObject({ sku: 'PIF-CSV-1', stock: '4', price_isk: '1000' });
    expect(row.name).toMatch(/line[\r\n]+one/);
    await db.query('DELETE FROM products WHERE id = $1', [p.id]);
  });

  test('a supplier .xlsx: Icelandic headers map, the order quantity is reported as skipped, never stock', async () => {
    const buf = await xlsx([
      ['Pöntun frá birgi'],
      [],
      ['Vörunúmer', 'Heiti', 'Strikamerki', 'Birgðir', 'Magn', 'Athugasemd'],
      ['PIF-X-1', 'Mug', '5690001000017', 12, 40, 'fragile'],
    ]);
    const res = await parse(buf, 'birgir.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('xlsx');
    expect(res.body.rows).toEqual([{ sku: 'PIF-X-1', name: 'Mug', barcode: '5690001000017', stock: '12' }]);
    expect(res.body.orderQtyColumns).toEqual(['Magn']);
    expect(res.body.ignored).toEqual(['Athugasemd']);
  });

  test('a generated PDF order: our code behind a label, the GTIN as the barcode', async () => {
    const buf = await pdfBuffer([
      { x: 40, y: 80,  text: 'Purchase order 4500001' },
      { x: 40, y: 120, text: 'Your material number 77005' },
      { x: 40, y: 140, text: 'EAN/UPC 4001234567890' },
      { x: 40, y: 180, text: 'Your material number 77006' },
      { x: 40, y: 200, text: 'EAN/UPC 4001234567891' },
    ]);
    const res = await parse(buf, 'po.pdf', 'application/pdf');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('pdf');
    expect(res.body.rows).toEqual([
      { sku: '77005', barcode: '4001234567890' },
      { sku: '77006', barcode: '4001234567891' },
    ]);
  });

  test('an unsupported or unreadable file is a localised 400; no file is a 400; anonymous is a 401', async () => {
    const bad = await parse(Buffer.from('MZ\u0000\u0001'), 'tool.exe', 'application/x-msdownload');
    expect(bad.status).toBe(400);
    const corrupt = await parse(Buffer.from('PK\u0003\u0004 not really a workbook'), 'broken.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(corrupt.status).toBe(400);
    expect(corrupt.body).toMatchObject({ code: 400, reason: 'unreadable' });
    const none = await request(app).post(PARSE).set('Cookie', adminCookie);
    expect(none.status).toBe(400);
    const anon = await request(app).post(PARSE).attach('file', Buffer.from('SKU\nX'), { filename: 'a.csv', contentType: 'text/csv' });
    expect(anon.status).toBe(401);
  });
});

describe('Barcode is the fallback match key', () => {
  let single, variant;
  beforeAll(async () => {
    single = await Product.create({ slug: 'pif-bar', name: 'PIF Bar', price_isk: 1000, price_eur: 700, stock: 2, barcode: '5690000000010' });
    const vp = await Product.create({ slug: 'pif-bar-v', name: 'PIF Bar V', price_isk: 1000, price_eur: 700, variant_axes: ['size'] });
    variant = await ProductVariant.create({ product_id: vp.id, sku: 'PIF-BV-M', attributes: { size: 'M' }, stock: 1, barcode: '5690000000027' });
    await Product.create({ slug: 'pif-amb-1', name: 'PIF Amb 1', price_isk: 1000, price_eur: 700, barcode: '5690000000034' });
    await Product.create({ slug: 'pif-amb-2', name: 'PIF Amb 2', price_isk: 1000, price_eur: 700, barcode: '5690000000034' });
  });

  test('a barcode-only row updates the product or the variant that carries it, audited as an import', async () => {
    const rows = [{ barcode: '5690000000010', stock: '9' }, { barcode: '5690000000027', stock: '6' }];
    const pre = await request(app).post(PREVIEW).set('Cookie', adminCookie).send({ rows });
    expect(pre.body.counts).toMatchObject({ update: 2 });
    const res = await request(app).post(APPLY).set('Cookie', adminCookie).send({ rows });
    expect(res.body).toMatchObject({ updated: 2 });
    expect((await Product.findById(single.id)).stock).toBe(9);
    expect((await ProductVariant.findById(variant.id)).stock).toBe(6);
    const { rows: adj } = await db.query(
      "SELECT reason, delta FROM inventory_adjustments WHERE product_variant_id = $1 AND reason = 'import'", [variant.id]);
    expect(adj).toEqual([{ reason: 'import', delta: 5 }]);
  });

  test('a barcode on two catalogue rows is refused, never guessed; the same barcode twice in a file too', async () => {
    const res = await request(app).post(PREVIEW).set('Cookie', adminCookie).send({ rows: [
      { barcode: '5690000000034', stock: '1' },
      { barcode: '5690000000010', stock: '3' },
      { barcode: '5690000000010', stock: '4' },
    ] });
    expect(res.body.rows.map(r => [r.status, r.reason])).toEqual([
      ['error', 'ambiguousBarcode'], ['error', 'duplicateBarcode'], ['error', 'duplicateBarcode'],
    ]);
  });

  test('SKU still wins over barcode', async () => {
    const res = await request(app).post(PREVIEW).set('Cookie', adminCookie).send({ rows: [
      { sku: 'PIF-BV-M', barcode: '5690000000010', stock: '2' },
    ] });
    expect(res.body.rows[0]).toMatchObject({ status: 'update', kind: 'variant' });
  });
});

describe('rows with a Variant cell create one Draft product with its variants (create: true)', () => {
  const grid = (over = {}) => [
    { sku: 'PIF-TEE-S', name: 'PIF Viking Tee', __variant: 'size: S, color: Black', price_isk: '3990', price_eur: '2700', stock: '5', barcode: '5690000000041' },
    { sku: 'PIF-TEE-M', name: 'PIF Viking Tee', __variant: 'Stærð: M, Litur: Black', price_isk: '3990', price_eur: '2700', stock: '0' },
    { sku: 'PIF-TEE-L', name: 'PIF Viking Tee', __variant: 'size: L, color: Black', price_isk: '4290', price_eur: '2900', stock: '2', ...over },
  ];

  test('without create the rows are only unmatched; preview with create plans one product', async () => {
    const plain = await request(app).post(PREVIEW).set('Cookie', adminCookie).send({ rows: grid() });
    expect(plain.body.counts).toMatchObject({ unmatched: 3, create: 0 });
    const res = await request(app).post(PREVIEW).set('Cookie', adminCookie).send({ rows: grid(), create: true });
    expect(res.body.counts).toMatchObject({ create: 3 });
    expect(res.body.createProducts).toBe(1);
    expect(res.body.rows[0].group).toMatchObject({ name: 'PIF Viking Tee', count: 3, axes: ['size', 'color'] });
  });

  test('apply creates the product as a Draft, its variants, their barcode and audited opening stock', async () => {
    const res = await request(app).post(APPLY).set('Cookie', adminCookie).send({ rows: grid(), create: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, createdVariants: 3, failed: 0 });
    const { rows: [p] } = await db.query("SELECT * FROM products WHERE name = 'PIF Viking Tee'");
    expect(p).toMatchObject({ active: false, price_isk: 3990, price_eur: 2700, slug: 'pif-viking-tee' });
    expect(p.variant_axes).toEqual(['size', 'color']);
    const variants = await ProductVariant.listForProduct(p.id, { activeOnly: false });
    const bySku = Object.fromEntries(variants.map(v => [v.sku, v]));
    expect(bySku['PIF-TEE-M'].attributes).toEqual({ size: 'M', color: 'Black' });
    expect(bySku['PIF-TEE-S']).toMatchObject({ stock: 5, barcode: '5690000000041', price_isk: null });
    expect(bySku['PIF-TEE-L']).toMatchObject({ price_isk: 4290, price_eur: 2900 });
    const { rows: adj } = await db.query(
      "SELECT reason, note, delta FROM inventory_adjustments WHERE product_id = $1 ORDER BY delta", [p.id]);
    expect(adj).toEqual([
      { reason: 'opening', note: 'import', delta: 2 },
      { reason: 'opening', note: 'import', delta: 5 },
    ]);
  });

  test('a second run is refused whole: the product exists, and its SKUs now match as updates', async () => {
    const res = await request(app).post(PREVIEW).set('Cookie', adminCookie)
      .send({ rows: grid().map(r => ({ ...r, sku: r.sku + '-NEW', barcode: undefined })), create: true });
    expect(res.body.rows.every(r => r.status === 'error' && r.reason === 'groupExists')).toBe(true);
  });

  test('one bad row refuses the whole product: a missing EUR price names the field, the siblings say why', async () => {
    const rows = grid().map(r => ({ ...r, sku: r.sku.replace('TEE', 'POLO'), name: 'PIF Polo', barcode: undefined }));
    delete rows[1].price_eur;
    const res = await request(app).post(PREVIEW).set('Cookie', adminCookie).send({ rows, create: true });
    expect(res.body.rows.map(r => r.reason)).toEqual(['groupRefused', 'priceRequired', 'groupRefused']);
    expect(res.body.rows[1].errorField).toBe('price_eur');
    const apply = await request(app).post(APPLY).set('Cookie', adminCookie).send({ rows, create: true });
    expect(apply.body).toMatchObject({ created: 0 });
    const { rows: none } = await db.query("SELECT 1 FROM products WHERE name = 'PIF Polo'");
    expect(none).toHaveLength(0);
  });
});
