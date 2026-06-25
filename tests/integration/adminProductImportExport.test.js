// Integration tests for the products CSV round-trip: export streams the full
// catalogue (one row per sellable unit); import matches by SKU (variant-first),
// previews changes, and applies updates to existing rows only (never create/
// delete). Stock is written directly. CSRF is bypassed in test mode.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Product = require('../../server/models/Product');
const ProductVariant = require('../../server/models/ProductVariant');
const { getTestSessionCookie, cleanTables } = require('../helpers');

const EXPORT  = '/api/v1/admin/shop/products/export.csv';
const PREVIEW = '/api/v1/admin/shop/products/import/preview';
const APPLY   = '/api/v1/admin/shop/products/import/apply';

let adminCookie, p1, p2, v1;

beforeAll(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();
  p1 = await Product.create({
    slug: 'csv-test-simple', name: 'CSV Simple', price_isk: 1000, price_eur: 700,
    category: 'product', stock: 5, sku: 'CSV-P1', bin: 'A-001',
  });
  p2 = await Product.create({
    slug: 'csv-test-variant', name: 'CSV Variant', price_isk: 2000, price_eur: 1400,
    category: 'product', stock: 0, variant_axes: ['size'],
  });
  v1 = await ProductVariant.create({
    product_id: p2.id, sku: 'CSV-V1', attributes: { size: 'M' },
    price_isk: null, price_eur: null, stock: 3, bin: 'B-002', active: true,
  });
});

afterAll(async () => {
  await db.query("DELETE FROM products WHERE slug LIKE 'csv-test-%'"); // CASCADE drops variants
});

describe('GET /products/export.csv', () => {
  test('streams a BOM-prefixed CSV with the canonical header and a row per unit', async () => {
    const res = await request(app).get(EXPORT).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="products-/);
    expect(res.text).toContain('SKU,Name,Variant,Barcode,BIN,Price ISK,Price EUR,Stock,Active');
    expect(res.text).toContain('CSV-P1'); // the simple product's row
    expect(res.text).toContain('CSV-V1'); // the variant row
  });

  test('401 when unauthenticated', async () => {
    expect((await request(app).get(EXPORT)).status).toBe(401);
  });
});

describe('POST /products/import/preview', () => {
  test('classifies update / nochange / unmatched / error', async () => {
    const rows = [
      { sku: 'CSV-P1', stock: '99' },        // update (5 → 99)
      { sku: 'CSV-V1', stock: '3' },         // nochange (already 3)
      { sku: 'NOPE',   stock: '1' },         // unmatched
      { sku: 'CSV-P1', price_isk: 'abc' },   // error (invalid value)
    ];
    const res = await request(app).post(PREVIEW).set('Cookie', adminCookie).send({ rows });
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ update: 1, nochange: 1, unmatched: 1, error: 1 });
  });

  test('treats price 0 as invalid (DB CHECK price > 0)', async () => {
    const res = await request(app).post(PREVIEW).set('Cookie', adminCookie)
      .send({ rows: [{ sku: 'CSV-P1', price_isk: '0' }] });
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ error: 1, update: 0 });
  });

  test('400 without a rows array', async () => {
    expect((await request(app).post(PREVIEW).set('Cookie', adminCookie).send({})).status).toBe(400);
  });

  test('400 when too many rows', async () => {
    const rows = Array.from({ length: 5001 }, () => ({ sku: 'x' }));
    expect((await request(app).post(PREVIEW).set('Cookie', adminCookie).send({ rows })).status).toBe(400);
  });
});

describe('POST /products/import/apply', () => {
  test('updates existing rows only (variant-first), writing stock directly', async () => {
    const rows = [
      { sku: 'CSV-P1', stock: '42', price_isk: '1234', active: 'false', bin: 'Z-9' },
      { sku: 'CSV-V1', stock: '7' },
      { sku: 'NOPE',   stock: '1' }, // never created — skipped
    ];
    const res = await request(app).post(APPLY).set('Cookie', adminCookie).send({ rows });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 2, skipped: 1, total: 3 });

    const p1After = await Product.findById(p1.id);
    expect(p1After.stock).toBe(42);
    expect(Number(p1After.price_isk)).toBe(1234);
    expect(p1After.active).toBe(false);
    expect(p1After.bin).toBe('Z-9');

    const v1After = await ProductVariant.findById(v1.id);
    expect(v1After.stock).toBe(7);

    // No phantom product was created for the unmatched SKU.
    const { rows: nope } = await db.query("SELECT 1 FROM products WHERE sku = 'NOPE'");
    expect(nope).toHaveLength(0);
  });

  test('401 when unauthenticated', async () => {
    const res = await request(app).post(APPLY).send({ rows: [{ sku: 'CSV-P1', stock: '1' }] });
    expect(res.status).toBe(401);
  });
});
