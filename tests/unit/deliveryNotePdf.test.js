'use strict';

// The delivery note as a pick list (harvest 2 lane 6c, ported from
// icelandicstore #8/#334/#335): lines walked by shelf (BIN, then SKU), a BIN and
// a SKU column, the size printed under the name (and not twice), one embed per
// picture per PDF, and at most four picture decodes at once. The PDF is drawn
// into a real pdfkit document; doc.text / doc.openImage are observed rather
// than parsing the compressed output.
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { drawDeliveryNote, sortLines } = require('../../server/services/pdfService');
const { _withDecodeSlot, DECODE_CONCURRENCY } = require('../../server/services/deliveryNote');
const { lineVariantLabel } = require('../../server/utils/variantLabel');

const ORDER = { order_number: 'OS-1', created_at: '2026-09-26T10:00:00Z', shipping_address: null, guest_name: 'Test Buyer' };
const STORE = { store_name: 'Test Store' };

function draw(items) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const texts = [];
  const opened = [];
  const origText = doc.text.bind(doc);
  doc.text = function (str, ...rest) { texts.push(String(str)); return origText(str, ...rest); };
  const origOpen = doc.openImage.bind(doc);
  doc.openImage = function (src) { opened.push(src); return origOpen(src); };
  drawDeliveryNote(doc, { order: ORDER, items, store: STORE });
  doc.end();
  return { texts, opened };
}

const line = (name, sku, bin, qty = 1, extra = {}) => ({ product_name_snapshot: name, sku, bin, quantity: qty, ...extra });

describe('line order', () => {
  test('walks the shelves: BIN in natural order, then SKU; no shelf last', () => {
    const items = [
      line('No shelf', 'Z-1', null),
      line('B ten', 'S-2', 'B-10'),
      line('B two b', 'S-9', 'B-2'),
      line('B two a', 'S-1', 'B-2'),
      line('A one', 'S-5', 'A-1'),
    ];
    expect(sortLines(items).map(i => i.product_name_snapshot)).toEqual(['A one', 'B two a', 'B two b', 'B ten', 'No shelf']);
  });

  test('the PDF prints the lines in that order', () => {
    const { texts } = draw([line('Second', 'S-2', 'B-2'), line('First', 'S-1', 'A-1'), line('Third', 'S-3', null)]);
    const names = texts.filter(t => ['First', 'Second', 'Third'].includes(t));
    expect(names).toEqual(['First', 'Second', 'Third']);
  });
});

describe('columns', () => {
  test('the header names BIN, SKU and QTY, and every line prints its BIN and SKU', () => {
    const { texts } = draw([line('Tee', 'TEE-BLK-M', 'A-4', 3), line('Mug', null, null, 2)]);
    for (const h of ['#', 'PRODUCT', 'BIN', 'SKU', 'QTY']) expect(texts).toContain(h);
    expect(texts).toContain('TEE-BLK-M');
    expect(texts).toContain('A-4');
    // A line without a code or shelf prints a dash, never "null".
    expect(texts.filter(t => t === '—').length).toBeGreaterThanOrEqual(2);
    expect(texts.join('|')).not.toMatch(/null|undefined/);
    expect(texts).toContain('2 lines · 5 units');
  });

  test('the variant size prints under the name', () => {
    const { texts } = draw([line('Tee', 'T-1', 'A-1', 1, { variant_label: 'Black / M' })]);
    expect(texts.indexOf('Black / M')).toBeGreaterThan(texts.indexOf('Tee'));
  });

  test('a name that already carries the size gets no label (no double size)', () => {
    const checkout = { product_name_snapshot: 'Tee — Black / M', variant_attributes: { color: 'Black', size: 'M' }, variant_axes: ['color', 'size'] };
    expect(lineVariantLabel(checkout)).toBeNull();
    const staff = { product_name_snapshot: 'Tee', variant_attributes: null, variant_attributes_current: { size: 'M', color: 'Black' }, variant_axes: ['color', 'size'] };
    expect(lineVariantLabel(staff)).toBe('Black / M'); // the product's axis order
  });
});

describe('pictures', () => {
  test('one embed per picture per PDF, however many lines show it', async () => {
    const buf = await sharp({ create: { width: 120, height: 120, channels: 3, background: { r: 200, g: 60, b: 40 } } }).jpeg().toBuffer();
    const other = await sharp({ create: { width: 90, height: 120, channels: 3, background: { r: 20, g: 60, b: 140 } } }).jpeg().toBuffer();
    const { opened } = draw([
      line('A', 'S-1', 'A-1', 1, { image: buf }),
      line('B', 'S-2', 'A-2', 1, { image: buf }),
      line('C', 'S-3', 'A-3', 1, { image: other }),
      line('D', 'S-4', 'A-4', 1, { image: buf }),
    ]);
    expect(opened).toHaveLength(2);
  });

  test('an undecodable picture costs the line its picture, never the PDF', () => {
    expect(() => draw([line('Broken', 'S-1', 'A-1', 1, { image: Buffer.from('not an image') })])).not.toThrow();
  });

  test(`at most ${DECODE_CONCURRENCY} decodes run at once`, async () => {
    let running = 0; let peak = 0;
    const job = () => _withDecodeSlot(async () => {
      running += 1; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 15));
      running -= 1;
      return true;
    });
    const results = await Promise.all(Array.from({ length: 12 }, job));
    expect(results.every(Boolean)).toBe(true);
    expect(peak).toBe(DECODE_CONCURRENCY);
    expect(DECODE_CONCURRENCY).toBe(4);
  });
});
