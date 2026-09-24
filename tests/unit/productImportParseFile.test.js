'use strict';

// Unit tests for the products-import file reader: which column of an uploaded
// file feeds which product field, and how a trade document that puts our code
// behind a LABEL is read.
//
// Fixtures are real files built here with the repo's own writers (exceljs,
// pdfkit) and read back through the repo's own readers (goodsReceipt/parseXlsx,
// salesReport/parsePdf) — the same path a live upload takes. They are built
// rather than committed because the documents that prompted the feature are real
// purchase orders, and another company's trading terms do not belong in git.
const ExcelJS = require('exceljs');
const { pdfFile } = require('../fixtures/pdfFixture');
const {
  parseProductImportFile, ProductImportParseError,
  rowsFromGrid, rowsFromLabels, detectKind, cleanCode, stripSentencePunctuation,
} = require('../../server/services/productImport/parseFile');
const { buildHeaderMap, normalizeHeader } = require('../../server/services/productImport/headerMap');

// icelandicstore's 22-column PRODUCT_CSV_COLUMNS, kept as harvested (ice@4694289,
// harvest-ice-d-2026-09-24): the reader is driven by whatever column table it is
// given, and a wider table exercises more of it. The ENGINE's own 10-column
// table is bound end to end in tests/integration/adminProductImportFile.test.js.
const COLUMNS = [
  ['SKU', 'sku', 'key'],
  ['Barcode', 'barcode', 'str'],
  ['BIN', 'bin', 'str'],
  ['Name', 'name', 'str'],
  ['Name (IS)', 'name_is', 'str'],
  ['Description', 'description', 'str'],
  ['Description (IS)', 'description_is', 'str'],
  ['Price ISK', 'price_isk', 'int'],
  ['Price EUR', 'price_eur', 'int'],
  ['Compare At ISK', 'compare_at_isk', 'int'],
  ['Cost ISK', 'cost_isk', 'int'],
  ['Stock', 'stock', 'int'],
  ['Pack Qty', 'pack_qty', 'int'],
  ['Weight (g)', 'weight_grams', 'int'],
  ['Product Type', 'category', 'str'],
  ['Category', 'product_category', 'str'],
  ['Vendor', 'vendor', 'str'],
  ['Tags', 'tags', 'tags'],
  ['Status', 'active', 'bool'],
  ['VAT %', 'vat_rate', 'vat'],
  ['Variant', '__variant', 'display'],
  ['Slug', 'slug', 'display'],
];

const MAP = buildHeaderMap(COLUMNS);

async function xlsxFile(rows, { sheet = 'Sheet1', filename = 'order.xlsx' } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  for (const r of rows) ws.addRow(r);
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    originalname: filename,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}


// One purchase-order item block: the buyer's article number in a column, OUR
// code behind a label, and the GTIN the two documents share.
function poItemRuns(item, index) {
  const top = 80 + index * 110;
  return [
    { x: 40,  y: top,      text: item.line },
    { x: 110, y: top,      text: item.buyerCode },
    { x: 240, y: top,      text: item.description },
    { x: 60,  y: top + 14, text: String(item.qty) },
    { x: 220, y: top + 14, text: 'items' },
    { x: 40,  y: top + 40, text: `Your material number ${item.ourCode}` },
    { x: 40,  y: top + 56, text: 'Int. Article No. (EAN/UPC)' },
    { x: 260, y: top + 56, text: item.gtin },
  ];
}

const PO_ITEMS = [
  { line: '00010', buyerCode: '1695434', description: 'Skin Care 77005', qty: 120, ourCode: '77005', gtin: '4001234567890' },
  { line: '00020', buyerCode: '1695435', description: 'Skin Care 77006', qty: 60,  ourCode: '77006', gtin: '4001234567891' },
];

describe('header vocabulary', () => {
  test('normalises punctuation and case, Icelandic letters intact', () => {
    expect(normalizeHeader('Int. Article No. (EAN/UPC)')).toBe('int article no ean upc');
    expect(normalizeHeader('  Price ISK  ')).toBe('price isk');
    expect(normalizeHeader('Vörunúmer')).toBe('vörunúmer');
  });

  test('maps the canonical export headers', () => {
    expect(MAP.fieldFor('SKU')).toBe('sku');
    expect(MAP.fieldFor('Price ISK')).toBe('price_isk');
    expect(MAP.fieldFor('Pack Qty')).toBe('pack_qty');
    expect(MAP.fieldFor('VAT %')).toBe('vat_rate');
    expect(MAP.fieldFor('Status')).toBe('active');
  });

  test('maps supplier and Icelandic synonyms', () => {
    expect(MAP.fieldFor('GTIN')).toBe('barcode');
    expect(MAP.fieldFor('Int. Article No. (EAN/UPC)')).toBe('barcode');
    expect(MAP.fieldFor('Strikamerki')).toBe('barcode');
    expect(MAP.fieldFor('Vörunúmer')).toBe('sku');
    expect(MAP.fieldFor('Article')).toBe('sku');
    expect(MAP.fieldFor('Birgðir')).toBe('stock');
    expect(MAP.fieldFor('Hilla')).toBe('bin');
    expect(MAP.fieldFor('Verð ISK')).toBe('price_isk');
  });

  test('an ORDER quantity is never a stock column', () => {
    for (const h of ['Order Quantity', 'Order qty.', 'Magn', 'Quantity', 'Fjöldi', 'Pcs']) {
      expect(MAP.fieldFor(h)).toBeNull();
      expect(MAP.isOrderQty(h)).toBe(true);
    }
    // A real stock header still maps, and Pack Qty is untouched.
    expect(MAP.isOrderQty('Stock')).toBe(false);
    expect(MAP.fieldFor('Stock')).toBe('stock');
    expect(MAP.isOrderQty('Pack Qty')).toBe(false);
    expect(MAP.fieldFor('Pack Qty')).toBe('pack_qty');
  });

  test('an unknown header maps to nothing', () => {
    expect(MAP.fieldFor('Purchasing Document')).toBeNull();
    expect(MAP.isOrderQty('Purchasing Document')).toBe(false);
  });
});

describe('cleanCode', () => {
  test('undoes numeric-cell damage and separator typing', () => {
    expect(cleanCode('4001234567890.0', { digitsOnly: true })).toBe('4001234567890');
    expect(cleanCode('400 1234-567891', { digitsOnly: true })).toBe('4001234567891');
    expect(cleanCode('  MAG-1  ')).toBe('MAG-1');
    // A SKU keeps its separators — only barcodes are digit-folded.
    expect(cleanCode('MAG-1')).toBe('MAG-1');
  });
});

describe('rowsFromGrid', () => {
  test('reads a purchase-order grid and refuses its order quantity', () => {
    const out = rowsFromGrid([
      ['Article', 'GTIN', 'Short Text', 'Order Quantity', 'Order Unit', 'Purchasing Document'],
      ['1695434', '4001234567890', 'Widget', '120', 'PC', '4505570952'],
      ['1695435', '4001234567891', 'Gadget', '60', 'PC', '4505570952'],
    ], MAP, { maxRows: 100 });

    expect(out.rows).toEqual([
      { sku: '1695434', barcode: '4001234567890' },
      { sku: '1695435', barcode: '4001234567891' },
    ]);
    expect(out.orderQtyColumns).toEqual(['Order Quantity']);
    expect(out.ignored).toEqual(['Short Text', 'Order Unit', 'Purchasing Document']);
    // Nothing writable came out of this file (barcode identifies, it is not a change).
    expect(out.importableFields).toEqual([]);
  });

  test('finds the header below a banner row', () => {
    const out = rowsFromGrid([
      ['Supplier price list — valid from 01.09.2026'],
      [],
      ['SKU', 'Stock', 'Price ISK'],
      ['MAG-1', '7', '390'],
    ], MAP, { maxRows: 100 });
    expect(out.headers).toEqual(['SKU', 'Stock', 'Price ISK']);
    expect(out.rows).toEqual([{ sku: 'MAG-1', stock: '7', price_isk: '390' }]);
    expect(out.importableFields).toEqual(expect.arrayContaining(['stock', 'price_isk']));
  });

  test('blank cells mean no change, and a row with no code is dropped', () => {
    const out = rowsFromGrid([
      ['SKU', 'Stock', 'BIN'],
      ['MAG-1', '', 'B-2'],
      ['', '9', 'C-3'],
    ], MAP, { maxRows: 100 });
    expect(out.rows).toEqual([{ sku: 'MAG-1', bin: 'B-2' }]);
  });

  test('no identifier column ⇒ nothing to match on', () => {
    expect(rowsFromGrid([['Name', 'Stock'], ['Widget', '3']], MAP, { maxRows: 100 })).toBeNull();
  });

  test('respects the row cap', () => {
    const grid = [['SKU', 'Stock']];
    for (let i = 0; i < 20; i += 1) grid.push([`P-${i}`, '1']);
    const out = rowsFromGrid(grid, MAP, { maxRows: 5 });
    expect(out.rows).toHaveLength(5);
    expect(out.truncated).toBe(true);
  });
});

describe('rowsFromLabels', () => {
  test('pairs our labelled code with the GTIN, per item block', () => {
    const out = rowsFromLabels([
      '00010 1695434 Skin Care 77005',
      'Your material number 77005',
      'Int. Article No. (EAN/UPC) 4001234567890',
      '00020 1695435 Skin Care 77006',
      'Your material number 77006',
      'Int. Article No. (EAN/UPC) 4001234567891',
    ], { maxRows: 100 });
    expect(out.rows).toEqual([
      { sku: '77005', barcode: '4001234567890' },
      { sku: '77006', barcode: '4001234567891' },
    ]);
  });

  test('a table header is not read as a labelled value', () => {
    // The word SKU appears, but "Description" has no digit in it.
    const out = rowsFromLabels(['SKU Description Price ISK', 'MAG-1 Cats Magnet 390'], { maxRows: 100 });
    expect(out.rows).toEqual([]);
  });

  test('a label repeated with the same value does not split the item', () => {
    // Regression: plenty of templates print the EAN twice per item block. Read
    // as a boundary, the repeat shifted every later pairing — the next item's
    // SKU landed in a record holding the PREVIOUS item's barcode, and since
    // Barcode is writable, applying that row overwrote one product's barcode
    // with another's.
    const out = rowsFromLabels([
      '00010 1695434 Skin Care 77005',
      'Your material number 77005',
      'Int. Article No. (EAN/UPC) 4001234567890',
      'EAN 4001234567890',
      '00020 1695435 Skin Care 77006',
      'Your material number 77006',
      'Int. Article No. (EAN/UPC) 4001234567891',
      'EAN 4001234567891',
    ], { maxRows: 100 });
    expect(out.rows).toEqual([
      { sku: '77005', barcode: '4001234567890' },
      { sku: '77006', barcode: '4001234567891' },
    ]);
  });

  // QA 2026-09-13: the code in running text kept the sentence's full stop.
  test('a labelled code in a sentence loses trailing punctuation, never its inner dots or dashes', () => {
    const out = rowsFromLabels([
      'Vörunúmer QA0913-A2. Hlýir tvíþættir vettlingar, ein stærð sem passar flestum.',
      'Vörunúmer: QA0913-A4. Langur og mjúkur trefill, 180 cm.',
      'Vörunr. AB.12-3/4.',
      'SKU 77065, verð 1.990 kr',
    ], { maxRows: 100 });
    expect(out.rows.map(r => r.sku)).toEqual(['QA0913-A2', 'QA0913-A4', 'AB.12-3/4', '77065']);
    expect(stripSentencePunctuation('AB-1.)')).toBe('AB-1');
    expect(stripSentencePunctuation('v1.2')).toBe('v1.2');
    // "Vörunúmer 7." is a one-character code once the stop goes — not a code.
    expect(rowsFromLabels(['Vörunúmer 7.'], { maxRows: 100 }).rows).toEqual([]);
  });

  test('two codes on one line are refused rather than glued together', () => {
    const out = rowsFromLabels([
      'Your material number 77005',
      'Int. Article No. (EAN/UPC) 4001234567890 4001234567891',
    ], { maxRows: 100 });
    expect(out.rows).toEqual([{ sku: '77005' }]);
  });
});

describe('detectKind', () => {
  test('reads the extension, then the MIME, then the bytes', () => {
    expect(detectKind({ originalname: 'a.xlsx', mimetype: '', buffer: Buffer.alloc(8) })).toBe('xlsx');
    expect(detectKind({ originalname: 'a.pdf', mimetype: '', buffer: Buffer.alloc(8) })).toBe('pdf');
    expect(detectKind({ originalname: 'a.csv', mimetype: '', buffer: Buffer.alloc(8) })).toBe('csv');
    // No usable name: the container decides.
    expect(detectKind({
      originalname: 'attachment', mimetype: 'application/octet-stream',
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    })).toBe('xlsx');
    expect(detectKind({
      originalname: 'attachment', mimetype: 'application/octet-stream',
      buffer: Buffer.from('%PDF-1.4\n'),
    })).toBe('pdf');
    expect(detectKind({
      originalname: 'attachment', mimetype: 'application/octet-stream',
      buffer: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]),
    })).toBeNull();
  });
});

describe('parseProductImportFile — xlsx', () => {
  test('reads a real workbook through to import rows', async () => {
    const file = await xlsxFile([
      ['Article', 'GTIN', 'Short Text', 'Order Quantity', 'Order Unit'],
      ['1695434', '4001234567890', 'Widget', 120, 'PC'],
      ['1695435', '4001234567891', 'Gadget', 60, 'PC'],
    ]);
    const out = await parseProductImportFile(file, { columns: COLUMNS, maxRows: 5000 });
    expect(out.source).toBe('xlsx');
    expect(out.rows).toEqual([
      { sku: '1695434', barcode: '4001234567890' },
      { sku: '1695435', barcode: '4001234567891' },
    ]);
    expect(out.orderQtyColumns).toEqual(['Order Quantity']);
    expect(out.importableFields).toEqual([]);
  });

  test('a price/stock list yields writable fields', async () => {
    const file = await xlsxFile([
      ['SKU', 'Barcode', 'Birgðir', 'Verð ISK'],
      ['MAG-1', '700001', 12, 420],
    ]);
    const out = await parseProductImportFile(file, { columns: COLUMNS, maxRows: 5000 });
    expect(out.rows).toEqual([{ sku: 'MAG-1', barcode: '700001', stock: '12', price_isk: '420' }]);
    expect(out.importableFields).toEqual(expect.arrayContaining(['stock', 'price_isk']));
  });

  test('a workbook with no product codes is refused', async () => {
    const file = await xlsxFile([['Name', 'Stock'], ['Widget', 3]]);
    await expect(parseProductImportFile(file, { columns: COLUMNS }))
      .rejects.toMatchObject({ reason: 'noIdentifierColumn' });
  });

  test('a corrupt workbook is a clean parse error, not a crash', async () => {
    const file = {
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03]),
      originalname: 'broken.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    await expect(parseProductImportFile(file, { columns: COLUMNS }))
      .rejects.toBeInstanceOf(ProductImportParseError);
  });
});

describe('parseProductImportFile — pdf', () => {
  test('takes our labelled code from a purchase order, not the buyer column', async () => {
    const runs = PO_ITEMS.map(poItemRuns).flat();
    const file = await pdfFile(runs);
    const out = await parseProductImportFile(file, { columns: COLUMNS, maxRows: 5000 });
    expect(out.source).toBe('pdf');
    expect(out.rows).toEqual([
      { sku: '77005', barcode: '4001234567890' },
      { sku: '77006', barcode: '4001234567891' },
    ]);
    // The buyer's own article numbers must not have been taken as our SKUs.
    expect(out.rows.map(r => r.sku)).not.toContain('1695434');
  });

  test('falls back to columns for a PDF that renders a plain table', async () => {
    const file = await pdfFile([
      { x: 40, y: 80,  text: 'SKU' },       { x: 200, y: 80,  text: 'Stock' }, { x: 340, y: 80,  text: 'Price ISK' },
      { x: 40, y: 100, text: 'MAG-1' },     { x: 200, y: 100, text: '7' },     { x: 340, y: 100, text: '390' },
      { x: 40, y: 120, text: 'TEE-BLK' },   { x: 200, y: 120, text: '3' },     { x: 340, y: 120, text: '1790' },
    ]);
    const out = await parseProductImportFile(file, { columns: COLUMNS, maxRows: 5000 });
    expect(out.rows).toEqual([
      { sku: 'MAG-1', stock: '7', price_isk: '390' },
      { sku: 'TEE-BLK', stock: '3', price_isk: '1790' },
    ]);
  });

  test('a PDF with no product codes at all is refused', async () => {
    const file = await pdfFile([{ x: 40, y: 80, text: 'Thank you for your business' }]);
    await expect(parseProductImportFile(file, { columns: COLUMNS }))
      .rejects.toBeInstanceOf(ProductImportParseError);
  });
});

describe('parseProductImportFile — csv and guards', () => {
  test('reads a CSV through the same mapper', async () => {
    const file = {
      buffer: Buffer.from('SKU,Barcode,Stock\nMAG-1,700001,9\n', 'utf8'),
      originalname: 'products.csv',
      mimetype: 'text/csv',
    };
    const out = await parseProductImportFile(file, { columns: COLUMNS, maxRows: 5000 });
    expect(out.source).toBe('csv');
    expect(out.rows).toEqual([{ sku: 'MAG-1', barcode: '700001', stock: '9' }]);
  });

  test('a quoted cell containing a line break keeps its row intact', async () => {
    // Regression: the order-import grid helper splits on newlines before it
    // splits cells, so this file lost MAG-1's Stock and left a bogus row. The
    // browser path reads it with the RFC-4180 parser, and the two must agree.
    const file = {
      buffer: Buffer.from('SKU,Name,Stock\r\nMAG-1,"Cats Magnet\r\nwith a long name",7\r\nTEE-BLK,Viking Tee,3\r\n', 'utf8'),
      originalname: 'products.csv',
      mimetype: 'text/csv',
    };
    const out = await parseProductImportFile(file, { columns: COLUMNS, maxRows: 5000 });
    expect(out.rows).toEqual([
      { sku: 'MAG-1', name: 'Cats Magnet\r\nwith a long name', stock: '7' },
      { sku: 'TEE-BLK', name: 'Viking Tee', stock: '3' },
    ]);
  });

  test('an empty upload and an unknown binary are both refused', async () => {
    await expect(parseProductImportFile({ buffer: Buffer.alloc(0), originalname: 'x.csv', mimetype: 'text/csv' }, { columns: COLUMNS }))
      .rejects.toMatchObject({ reason: 'empty' });
    await expect(parseProductImportFile({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]), originalname: 'sneaky', mimetype: 'application/octet-stream',
    }, { columns: COLUMNS })).rejects.toMatchObject({ reason: 'unsupportedType' });
  });

  // "unreadable" used to swallow the reader's error, which is how a failing PDF
  // parse went undiagnosed for weeks. The cause now rides on the parse error for
  // every reader — xlsx, pdf and csv alike.
  test('an unreadable workbook, PDF or CSV carries the reader\'s own error as cause', async () => {
    // An unterminated quote spanning EOF is what csv-parse still rejects under
    // relax_quotes / relax_column_count.
    const csvErr = await parseProductImportFile({
      buffer: Buffer.from('SKU,Stock\n"MAG-1,7\n', 'utf8'), originalname: 'broken.csv', mimetype: 'text/csv',
    }, { columns: COLUMNS }).catch(e => e);
    expect(csvErr).toBeInstanceOf(ProductImportParseError);
    expect(csvErr.reason).toBe('unreadable');
    expect(csvErr.cause).toBeInstanceOf(Error);

    const xlsxErr = await parseProductImportFile({
      buffer: Buffer.from('PK not really a zip'), originalname: 'broken.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }, { columns: COLUMNS }).catch(e => e);
    expect(xlsxErr).toBeInstanceOf(ProductImportParseError);
    expect(xlsxErr.reason).toBe('unreadable');
    expect(xlsxErr.cause).toBeInstanceOf(Error);

    const pdfErr = await parseProductImportFile({
      buffer: Buffer.from('%PDF-1.4\nthis is not a pdf body'), originalname: 'broken.pdf', mimetype: 'application/pdf',
    }, { columns: COLUMNS }).catch(e => e);
    expect(pdfErr).toBeInstanceOf(ProductImportParseError);
    expect(pdfErr.reason).toBe('unreadable');
    expect(pdfErr.cause).toBeInstanceOf(Error);
    expect(pdfErr.cause.message).toMatch(/pdf/i);
  });
});

// ── Variant axes at the import boundary ──────────────────────────────────────
// A supplier grid names the axes as columns (Stærð, Litur); the canonical file
// carries one "Variant" cell. Both must reach the create path as __variant in
// the shape the export writes, and the synonym fold happens here and nowhere
// else (utils/variantAxis is deliberately synonym-free).
describe('per-axis columns → __variant', () => {
  const csvFile = (text, filename = 'products.csv') => ({
    buffer: Buffer.from(text, 'utf8'), originalname: filename, mimetype: 'text/csv',
  });

  test('Stærð / Litur columns become one Variant cell with the canonical lowercase axis names', async () => {
    const out = await parseProductImportFile(await xlsxFile([
      ['SKU', 'Name', 'Price ISK', 'Stærð', 'Litur', 'Stock'],
      ['TEE-M-RED', 'Tee', 2990, 'M', 'Rauður', 4],
      ['TEE-L-RED', 'Tee', 2990, 'L', 'Rauður', 2],
    ]), { columns: COLUMNS });
    expect(out.rows.map(r => r.__variant)).toEqual(['size: M, color: Rauður', 'size: L, color: Rauður']);
    // Axis columns are consumed, not reported as ignored.
    expect(out.ignored).toEqual([]);
  });

  test('English synonyms fold the same way, and a blank axis cell contributes nothing', async () => {
    const out = await parseProductImportFile(await xlsxFile([
      ['SKU', 'Colour', 'Size'],
      ['A-1', 'Navy', 'XS'],
      ['A-2', '', 'S'],
    ]), { columns: COLUMNS });
    expect(out.rows.map(r => r.__variant)).toEqual(['color: Navy, size: XS', 'size: S']);
  });

  test('a canonical "Variant" cell wins over per-axis columns on the same row', async () => {
    const out = await parseProductImportFile(await xlsxFile([
      ['SKU', 'Variant', 'Size'],
      ['B-1', 'Color: Black, Size: M', 'L'],
    ]), { columns: COLUMNS });
    expect(out.rows[0].__variant).toBe('Color: Black, Size: M');
  });

  test('a CSV — the export round trip — carries Slug and Variant through untouched', async () => {
    // This used to be the browser parser's job; it is the server's now, and the
    // create path needs both columns exactly as exported.
    const out = await parseProductImportFile(csvFile(
      'SKU,Name,Price ISK,Variant,Slug\r\n' +
      'TEE-BLK,"Viking Tee",1590,"Color: Black, Size: M",viking-tee\r\n'
    ), { columns: COLUMNS });
    expect(out.source).toBe('csv');
    expect(out.rows[0]).toMatchObject({ sku: 'TEE-BLK', name: 'Viking Tee', price_isk: '1590',
                                        __variant: 'Color: Black, Size: M', slug: 'viking-tee' });
    // Display columns are carried, not counted as something the file changes.
    expect(out.importableFields).toEqual(expect.arrayContaining(['name', 'price_isk']));
    expect(out.importableFields).not.toContain('__variant');
    expect(out.importableFields).not.toContain('slug');
  });

  test('a quoted line break inside a cell stays inside the cell (the flaw the browser parser had)', async () => {
    const out = await parseProductImportFile(csvFile(
      'SKU,Name,Description,Stock\r\n' +
      'C-1,Cup,"Line one\r\nline two",7\r\n'
    ), { columns: COLUMNS });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ sku: 'C-1', stock: '7' });
    expect(out.rows[0].description).toMatch(/Line one[\r\n]+line two/);
  });
});
