'use strict';

/**
 * "Read with AI" routes (harvest 2 lane 6b; ported from icelandicstore
 * #306/#314): dark by default, the gate order (CSRF → flag 404 → budget 429 →
 * upload), the page caps, the shared AI gate sub-cap, a failed read refunded,
 * and AI rows that may only CREATE through the unchanged preview. The model is
 * STUBBED (aiExtract._setClientFactory); no test calls Anthropic.
 */
const request = require('supertest');
const PDFDocument = require('pdfkit');
const app = require('../../server/app');
const Product = require('../../server/models/Product');
const aiExtract = require('../../server/services/productImport/aiExtract');
const aiLimits = require('../../server/services/productImport/aiLimits');
const aiGate = require('../../server/services/aiGate');
const { getTestSessionCookie, cleanTables, createTestRegularUser } = require('../helpers');

const CONFIG = '/api/v1/admin/shop/products/import/ai-config';
const EXTRACT = '/api/v1/admin/shop/products/import/ai-extract';
const PREVIEW = '/api/v1/admin/shop/products/import/preview';
let adminCookie, userCookie;
const ENV_KEYS = ['PRODUCT_IMPORT_AI_ENABLED', 'ANTHROPIC_API_KEY', 'PRODUCT_IMPORT_AI_MAX_PAGES',
  'PRODUCT_IMPORT_AI_MAX_FILE_PAGES', 'PRODUCT_IMPORT_AI_USER_DAY_PAGES', 'PRODUCT_IMPORT_AI_MAX_CONCURRENT'];
const saved = {};

function pdfPages(pages) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    pages.forEach((lines, i) => {
      if (i) doc.addPage();
      lines.forEach((l, j) => doc.text(l, 40, 60 + j * 18, { lineBreak: false }));
    });
    doc.end();
  });
}
const extract = (buf, { from = 1, cookie = adminCookie, filename = 'list.pdf', type = 'application/pdf' } = {}) =>
  request(app).post(`${EXTRACT}?from=${from}`).set('Cookie', cookie).attach('file', buf, { filename, contentType: type });
const modelRow = (extra = {}) => ({
  parent_name: null, name: 'Ullarsokkar', axes: [], barcode: null, supplier_code: null, price: null,
  price_basis: 'unit', price_kind: 'net', price_role: 'sale', currency: 'ISK', vat_rate: null, pack_qty: null,
  uncertain: [], page: 1, ...extra,
});
const stubReply = (rows) => aiExtract._setClientFactory(() => ({
  messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ rows }) }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) },
}));

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  await cleanTables();
  adminCookie = await getTestSessionCookie();
  userCookie = await getTestSessionCookie(await createTestRegularUser());
});
afterAll(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  aiExtract._setClientFactory(null);
});
beforeEach(() => {
  aiLimits._reset(); aiGate._reset();
  process.env.PRODUCT_IMPORT_AI_ENABLED = 'true';
  process.env.ANTHROPIC_API_KEY = 'sk-test-never-used';
  delete process.env.PRODUCT_IMPORT_AI_MAX_PAGES;
  delete process.env.PRODUCT_IMPORT_AI_MAX_FILE_PAGES;
  delete process.env.PRODUCT_IMPORT_AI_USER_DAY_PAGES;
  delete process.env.PRODUCT_IMPORT_AI_MAX_CONCURRENT;
  aiExtract._setClientFactory(() => ({ messages: { create: async () => { throw new Error('no model in tests'); } } }));
});

describe('dark by default and gated', () => {
  test('off: config is 200 { enabled: false } and the extract route is 404 before any upload', async () => {
    process.env.PRODUCT_IMPORT_AI_ENABLED = 'false';
    const cfg = await request(app).get(CONFIG).set('Cookie', adminCookie);
    expect(cfg.status).toBe(200);
    expect(cfg.body).toMatchObject({ enabled: false, remainingPages: 0 });
    const res = await extract(await pdfPages([['x']]));
    expect(res.status).toBe(404);
  });

  test('credentials missing is off too; anonymous 401, no products view 403', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    expect((await request(app).get(CONFIG).set('Cookie', adminCookie)).body.enabled).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'sk-test-never-used';
    expect((await request(app).get(CONFIG)).status).toBe(401);
    expect((await request(app).get(CONFIG).set('Cookie', userCookie)).status).toBe(403);
  });

  test('on: config names the chunk size, the caps and what is left today', async () => {
    const res = await request(app).get(CONFIG).set('Cookie', adminCookie);
    expect(res.body).toEqual({ enabled: true, chunkPages: 3, maxPages: 10, maxFilePages: 40, remainingPages: 60 });
  });
});

describe('refusals before the paid call', () => {
  test('a non-PDF is 400 pdfOnly', async () => {
    const res = await extract(Buffer.from('SKU,Name\nA,B'), { filename: 'x.csv', type: 'text/csv' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('pdfOnly');
  });

  test('more pages than one request may carry is 422; past the per-file cap is 422 fileTooLong', async () => {
    process.env.PRODUCT_IMPORT_AI_MAX_PAGES = '2';
    const three = await pdfPages([['a'], ['b'], ['c']]);
    const res = await extract(three);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ reason: 'tooManyPages', max: 2 });
    process.env.PRODUCT_IMPORT_AI_MAX_FILE_PAGES = '5';
    const late = await extract(await pdfPages([['a'], ['b']]), { from: 5 });
    expect(late.status).toBe(422);
    expect(late.body.reason).toBe('fileTooLong');
  });

  test('a spent daily budget is 429 pageBudget with Retry-After, before the upload is read', async () => {
    process.env.PRODUCT_IMPORT_AI_USER_DAY_PAGES = '1';
    const { rows } = await require('../../server/config/database').query(`SELECT user_id FROM user_sessions LIMIT 1`);
    aiLimits.chargePages(rows[0].user_id, 1);
    const res = await extract(await pdfPages([['a']]));
    expect(res.status).toBe(429);
    expect(res.body.reason).toBe('pageBudget');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  test('the shared AI gate full → 429 AI_BUSY, and the pages are not charged', async () => {
    process.env.PRODUCT_IMPORT_AI_MAX_CONCURRENT = '1';
    expect(aiLimits.acquire()).toBe(true);
    try {
      const res = await extract(await pdfPages([['a']]));
      expect(res.status).toBe(429);
      expect(res.body.reason).toBe('AI_BUSY');
    } finally { aiLimits.release(); }
    const cfg = await request(app).get(CONFIG).set('Cookie', adminCookie);
    expect(cfg.body.remainingPages).toBe(60);
  });
});

describe('the read', () => {
  test('rows come back verified against the text layer, in the import shape, pages charged', async () => {
    stubReply([
      modelRow({ supplier_code: 'AB-12', price: 2490 }),
      modelRow({ supplier_code: 'NOT-PRINTED', price: 777 }),
    ]);
    const pdf = await pdfPages([['Ullarsokkar AB-12 Söluverð 2.490'], ['page two']]);
    const res = await extract(pdf, { from: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: 4, to: 5, pages: 2, remainingPages: 58 });
    expect(res.body.rows[0]).toEqual({ name: 'Ullarsokkar', sku: 'AB-12', price_isk: '2490', __ai: true, __page: 4 });
    expect(res.body.rows[1].sku).toBeUndefined();
    expect(res.body.rows[1].__uncertain).toEqual(expect.arrayContaining(['supplier_code', 'price']));
  });

  test('an API error status is 502 and gives its pages back (nothing was billed)', async () => {
    aiExtract._setClientFactory(() => ({ messages: { create: async () => { throw Object.assign(new Error('overloaded'), { status: 529 }); } } }));
    const res = await extract(await pdfPages([['a'], ['b']]));
    expect(res.status).toBe(502);
    expect((await request(app).get(CONFIG).set('Cookie', adminCookie)).body.remainingPages).toBe(60);
  });

  test('an unusable reply (the echo guard) is 502 and STAYS charged — a PDF cannot read for free', async () => {
    aiExtract._setClientFactory(() => ({ messages: { create: async (req) => ({ content: [{ type: 'text', text: req.system }], usage: { input_tokens: 1, output_tokens: 1 } }) } }));
    const res = await extract(await pdfPages([['a'], ['b']]));
    expect(res.status).toBe(502);
    expect((await request(app).get(CONFIG).set('Cookie', adminCookie)).body.remainingPages).toBe(58);
  });
});

describe('AI rows through the unchanged preview', () => {
  test('an AI row whose code is already ours is refused (aiCreateOnly), never an update', async () => {
    await Product.create({ slug: 'ai-existing', name: 'Existing', price_isk: 1000, price_eur: 700, sku: 'AI-EXIST', stock: 3 });
    const res = await request(app).post(PREVIEW).set('Cookie', adminCookie)
      .send({ rows: [{ sku: 'AI-EXIST', name: 'Existing', price_isk: '5', stock: '99', __ai: true }], create: true });
    expect(res.status).toBe(200);
    expect(res.body.rows[0]).toMatchObject({ status: 'error', reason: 'aiCreateOnly' });
    expect(res.body.counts.update).toBe(0);
  });

  test('priced AI variant rows plan one new product', async () => {
    const rows = ['S', 'M'].map(size => ({
      name: 'AI Peysa', sku: `AIP-${size}`, __variant: `size: ${size}`, price_isk: '9900', price_eur: '6900', __ai: true,
    }));
    const res = await request(app).post(PREVIEW).set('Cookie', adminCookie).send({ rows, create: true });
    expect(res.body.counts.create).toBe(2);
    expect(res.body.createProducts).toBe(1);
  });
});
