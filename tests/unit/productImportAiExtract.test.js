'use strict';

// The AI PDF reader's verification and cost gate (services/productImport/
// aiExtract.js + aiLimits.js; ported from icelandicstore #306/#314). The model
// is STUBBED through aiExtract._setClientFactory — no test ever calls Anthropic.
const aiExtract = require('../../server/services/productImport/aiExtract');
const aiLimits = require('../../server/services/productImport/aiLimits');
const aiGate = require('../../server/services/aiGate');
const { pdfLines } = require('../fixtures/pdfFixture');

const { verifyRows, deriveVariantSkus, extractProducts, pdfTextAndPages } = aiExtract;
const { gtinValid, numbersInText, textHasDigits, printedCode, salvageRows } = aiExtract._internal;

const row = (extra = {}) => ({
  parent_name: null, name: 'Ullarsokkar', axes: [], barcode: null, supplier_code: null, price: null,
  price_basis: 'unit', price_kind: 'net', price_role: 'sale', currency: 'ISK', vat_rate: null, pack_qty: null,
  uncertain: [], page: 1, ...extra,
});

describe('helpers', () => {
  test('GTIN check digit', () => {
    expect(gtinValid('5690000000015')).toBe(true);
    expect(gtinValid('5690000000016')).toBe(false);
  });
  test('numbers as prices are printed: groups, decimals, never across a tab', () => {
    const n = numbersInText('Verð 1.990 kr\t6\t1990\n2 490,00 og 19,90');
    expect(n.has(1990)).toBe(true);
    expect(n.has(2490)).toBe(true);
    expect(n.has(61990)).toBe(false);
    expect(n.has(1990 * 10)).toBe(false);
  });
  test('a barcode printed in groups counts; a code is taken as printed, punctuation dropped', () => {
    expect(textHasDigits('EAN 569 0000 000015', '5690000000015')).toBe(true);
    expect(printedCode('Vörunr. AB-12. næst', 'ab-12')).toBe('AB-12');
    expect(printedCode('nothing here', 'ab-12')).toBeNull();
  });
  test('salvageRows tolerates a fence and prose, refuses anything else', () => {
    expect(salvageRows('```json\n{"rows":[{"name":"x"}]}\n```')).toEqual([{ name: 'x' }]);
    expect(salvageRows('Here: {"rows":[]} done')).toEqual([]);
    expect(salvageRows('[1,2]')).toBeNull();
  });
});

describe('verifyRows', () => {
  const text = 'Ullarsokkar AB-12 5690000000015 Söluverð 2.490\nHúfa HU-1 Heildsöluverð 1.200';

  test('printed codes and a printed sale price are kept; the row is marked __ai with its page', () => {
    const { rows } = verifyRows([row({ supplier_code: 'ab-12', barcode: '5690000000015', price: 2490 })], text, { from: 4, pages: 3 });
    expect(rows[0]).toEqual({ name: 'Ullarsokkar', sku: 'AB-12', barcode: '5690000000015', price_isk: '2490', __ai: true, __page: 4 });
  });

  test('an unprinted or invalid code and an unprinted price are blanked and flagged', () => {
    const { rows, blankedCodes } = verifyRows([row({ supplier_code: 'ZZ-9', barcode: '5690000000016', price: 9999 })], text);
    expect(rows[0].sku).toBeUndefined();
    expect(rows[0].barcode).toBeUndefined();
    expect(rows[0].price_isk).toBeUndefined();
    expect(rows[0].__uncertain).toEqual(expect.arrayContaining(['barcode', 'supplier_code', 'price']));
    expect(blankedCodes).toBe(2);
  });

  test('a cost is never a selling price: cost / unknown → cost_isk (unknown flagged)', () => {
    const { rows } = verifyRows([
      row({ name: 'Húfa', price: 1200, price_role: 'cost' }),
      row({ name: 'Húfa', price: 1200, price_role: 'unknown' }),
    ], text);
    expect(rows[0]).toMatchObject({ cost_isk: '1200' });
    expect(rows[0].price_isk).toBeUndefined();
    expect(rows[1].__uncertain).toContain('price');
  });

  test('gross → net needs a printed VAT rate; a pack price needs a printed pack size', () => {
    const t2 = 'Vara 2.480 24% pakki 4';
    const [a, b, c] = verifyRows([
      row({ price: 2480, price_kind: 'gross', vat_rate: 24 }),
      row({ price: 2480, price_kind: 'gross', vat_rate: null }),
      row({ price: 2480, price_basis: 'pack', pack_qty: 4 }),
    ], t2).rows;
    expect(a.price_isk).toBe('2000');
    expect(b.price_isk).toBeUndefined();
    expect(c.price_isk).toBe('620');
  });

  test('create-only: a code that is already ours drops BOTH codes', () => {
    const { rows } = verifyRows([row({ supplier_code: 'AB-12', barcode: '5690000000015' })], text,
      { inUse: { codes: new Set(['ab-12']) } });
    expect(rows[0].sku).toBeUndefined();
    expect(rows[0].barcode).toBeUndefined();
    expect(rows[0].__uncertain).toContain('existing_product');
  });

  test('options become a Variant cell under the parent name', () => {
    const { rows } = verifyRows([row({ parent_name: 'Peysa', name: 'Peysa M', axes: [{ axis: 'Stærð', value: 'M' }] })], text);
    expect(rows[0]).toMatchObject({ name: 'Peysa', __variant: expect.stringMatching(/size: M/i) });
  });
});

describe('deriveVariantSkus', () => {
  test('rows of one product sharing one code get CODE-<values>, flagged sku_derived', () => {
    const { rows, derived } = deriveVariantSkus([
      { name: 'Peysa', sku: 'P1', __variant: 'size: S' }, { name: 'Peysa', sku: 'P1', __variant: 'size: M' },
    ]);
    expect(rows.map(r => r.sku)).toEqual(['P1-S', 'P1-M']);
    expect(rows[0].__uncertain).toContain('sku_derived');
    expect(derived).toBe(2);
  });
  test('a derived SKU that still collides is blanked, never guessed', () => {
    const { rows, blanked } = deriveVariantSkus([
      { name: 'Peysa', sku: 'P1', __variant: 'size: S' }, { name: 'Peysa', sku: 'P1', __variant: 'size: S' },
    ]);
    expect(rows.every(r => !r.sku)).toBe(true);
    expect(blanked).toBe(2);
  });
});

describe('extractProducts with a stubbed model', () => {
  let pdf, doc;
  beforeAll(async () => {
    pdf = await pdfLines(['Ullarsokkar AB-12 Söluverð 2.490']);
    doc = await pdfTextAndPages(pdf, { maxPages: 5 });
  });
  afterEach(() => aiExtract._setClientFactory(null));

  const stub = (impl) => aiExtract._setClientFactory(() => ({ messages: { create: impl } }));
  const reply = (obj, extra = {}) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, ...extra });

  test('reads the text layer and page count first', () => {
    expect(doc.pages).toBe(1);
    expect(doc.text).toMatch(/AB-12/);
  });

  test('sends the PDF as a document block with a JSON schema and the engine model; verifies the reply', async () => {
    const calls = [];
    stub(async (req, opts) => { calls.push({ req, opts }); return reply({ rows: [row({ supplier_code: 'AB-12', price: 2490 })] }); });
    const out = await extractProducts({ buffer: pdf, text: doc.text, pages: 1, lookupInUse: async () => ({ codes: new Set() }) });
    expect(out.rows).toEqual([expect.objectContaining({ sku: 'AB-12', price_isk: '2490', __ai: true })]);
    expect(out.meta).toMatchObject({ pages: 1, rows: 1, usage: { input_tokens: 10, output_tokens: 5 } });
    const { req, opts } = calls[0];
    expect(req.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.model).toBe(aiExtract.getModel());
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  test('the model id is the engine config, never a literal: PRODUCT_IMPORT_AI_MODEL, else TRANSLATE_MODEL', () => {
    const saved = { a: process.env.PRODUCT_IMPORT_AI_MODEL, b: process.env.TRANSLATE_MODEL };
    try {
      delete process.env.PRODUCT_IMPORT_AI_MODEL;
      process.env.TRANSLATE_MODEL = 'model-from-engine-config';
      expect(aiExtract.getModel()).toBe('model-from-engine-config');
      process.env.PRODUCT_IMPORT_AI_MODEL = 'model-for-import';
      expect(aiExtract.getModel()).toBe('model-for-import');
    } finally {
      if (saved.a === undefined) delete process.env.PRODUCT_IMPORT_AI_MODEL; else process.env.PRODUCT_IMPORT_AI_MODEL = saved.a;
      if (saved.b === undefined) delete process.env.TRANSLATE_MODEL; else process.env.TRANSLATE_MODEL = saved.b;
    }
  });

  test('a 400 naming temperature is retried once without it', async () => {
    const seen = [];
    stub(async (req) => {
      seen.push('temperature' in req);
      if (seen.length === 1) { const e = new Error('temperature is not supported'); e.status = 400; throw e; }
      return reply({ rows: [] });
    });
    const out = await extractProducts({ buffer: pdf, text: doc.text, pages: 1 });
    expect(seen).toEqual([true, false]);
    expect(out.rows).toEqual([]);
  });

  test('an echo or an unparseable reply fails and stays charged; an API error status is refundable; a timeout is not', async () => {
    const go = () => extractProducts({ buffer: pdf, text: doc.text, pages: 1 });
    stub(async (req) => ({ content: [{ type: 'text', text: req.system }] }));
    expect(await go()).toEqual({ rows: null, refundable: false });
    stub(async () => ({ content: [{ type: 'text', text: 'no json' }] }));
    expect(await go()).toEqual({ rows: null, refundable: false });
    stub(async () => { throw Object.assign(new Error('overloaded'), { status: 529 }); });
    expect(await go()).toEqual({ rows: null, refundable: true });
    stub(async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); });
    expect(await go()).toEqual({ rows: null, refundable: false });
  });

  test('the client going away cancels the model call', async () => {
    const ac = new AbortController();
    let sawAbort = false;
    stub((req, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => { sawAbort = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    }));
    const p = extractProducts({ buffer: pdf, text: doc.text, pages: 1, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    expect(await p).toBeNull();
    expect(sawAbort).toBe(true);
  });
});

describe('aiLimits — the cost gate', () => {
  const env = {};
  const set = (k, v) => { env[k] = process.env[k]; process.env[k] = v; };
  afterEach(() => {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    for (const k of Object.keys(env)) delete env[k];
    aiLimits._reset();
    aiGate._reset();
  });

  test('dark unless its own flag AND credentials are set', () => {
    set('PRODUCT_IMPORT_AI_ENABLED', 'false'); set('ANTHROPIC_API_KEY', 'sk-test');
    expect(aiLimits.isEnabled()).toBe(false);
    set('PRODUCT_IMPORT_AI_ENABLED', 'true');
    expect(aiLimits.isEnabled()).toBe(true);
    set('ANTHROPIC_API_KEY', '');
    expect(aiLimits.isEnabled()).toBe(false);
  });

  test('per user and per instance daily page budgets; a refund gives pages back; a new UTC day resets', () => {
    set('PRODUCT_IMPORT_AI_USER_DAY_PAGES', '5'); set('PRODUCT_IMPORT_AI_DAY_PAGES', '8');
    const t0 = Date.UTC(2026, 8, 26, 10);
    const c1 = aiLimits.chargePages('u1', 4, t0);
    expect(c1).toBeTruthy();
    expect(aiLimits.chargePages('u1', 2, t0)).toBeNull();          // user cap 5
    expect(aiLimits.chargePages('u2', 4, t0)).toBeTruthy();          // instance 8
    expect(aiLimits.chargePages('u3', 1, t0)).toBeNull();          // instance spent
    aiLimits.refundPages(c1);
    expect(aiLimits.remainingPages('u3', t0)).toBe(4);
    expect(aiLimits.remainingPages('u1', Date.UTC(2026, 8, 27, 0, 1))).toBe(5);
  });

  test('at most MAX_CONCURRENT of the shared AI gate slots', () => {
    set('PRODUCT_IMPORT_AI_MAX_CONCURRENT', '2');
    expect(aiLimits.acquire()).toBe(true);
    expect(aiLimits.acquire()).toBe(true);
    expect(aiLimits.acquire()).toBe(false);
    expect(aiGate.inFlight()).toBe(2);
    aiLimits.release(); aiLimits.release();
    expect(aiGate.inFlight()).toBe(0);
  });
});
