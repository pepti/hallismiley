// Read an uploaded product file — .xlsx, PDF or CSV — into the row shape the
// products import already consumes ({ sku, barcode, stock, price_isk, … }), so
// buildProductImportPlan / preview / apply stay untouched and there is exactly
// one classify-and-write path whatever the file was.
//
// Harvested from icelandicstore (ice@4694289, harvest-ice-d-2026-09-24). It
// replaces the engine's browser-side utils/productCsv.js: every file, CSV
// included, is read here.
//
// Nothing here parses a container format itself: the .xlsx goes through the
// ExcelJS reader (parseXlsx.js) and the PDF through the pdf-parse reader
// (parsePdf.js), both of which return the same { headerRow, headers, rows }
// grid. This file is only the products-specific part — which column means what
// (headerMap.js), and how to read a trade document that puts our code behind a
// LABEL rather than in a column.
const { parse: parseCsvSync } = require('csv-parse/sync');
const { parseXlsxBuffer } = require('./parseXlsx');
const { parsePdfBuffer }  = require('./parsePdf');
const { buildHeaderMap }  = require('./headerMap');
const { formatVariantCell } = require('./variantCell');
// The labelled-code vocabulary ("Your material number" / "EAN/UPC").
const {
  LABEL_SKU, LABEL_BARCODE, BARCODE_MIN, BARCODE_MAX,
  cleanCode, hasDigit, stripSentencePunctuation,
} = require('./tradeLabels');

const MAX_HEADER_SCAN = 25;   // rows to search for the header row

// `cause` carries the reader's own error (pdf.js / ExcelJS / csv-parse) so a
// rejected upload can be diagnosed: the controller logs it, and a failing test
// prints it instead of a bare "unreadable".
class ProductImportParseError extends Error {
  constructor(reason, { cause } = {}) {
    super('product import parse: ' + reason, cause ? { cause } : undefined);
    this.reason = reason;
  }
}

// ── shared helpers ──────────────────────────────────────────────────────────

// The first row (within the scan window) that names an identifier column. Without
// one there is nothing to match on, so a row of prices alone is not a header.
function findHeaderRow(grid, map) {
  for (let i = 0; i < Math.min(grid.length, MAX_HEADER_SCAN); i += 1) {
    const fields = (grid[i] || []).map(c => map.fieldFor(c));
    if (fields.some(f => f && map.identifiers.has(f))) return i;
  }
  return -1;
}

/**
 * grid (array of row arrays) → the import-row payload, or null when no header
 * row carries a product code.
 */
function rowsFromGrid(grid, map, { maxRows }) {
  const headerAt = findHeaderRow(grid, map);
  if (headerAt === -1) return null;

  const headers = (grid[headerAt] || []).map(h => String(h == null ? '' : h).trim());
  const fieldByCol = headers.map(h => map.fieldFor(h));
  // Per-axis columns (Stærð / Size, Litur / Colour …): a supplier grid names
  // the axes as columns where the canonical file carries one "Variant" cell.
  // Both end up as __variant, written the way the export writes it, so the
  // create path downstream sees one shape whatever the file looked like.
  const axisByCol = headers.map((h, i) => (fieldByCol[i] ? null : map.axisFor(h)));

  const ignored = [];
  const orderQtyColumns = [];
  headers.forEach((h, i) => {
    if (!h || fieldByCol[i] || axisByCol[i]) return;
    if (map.isOrderQty(h)) orderQtyColumns.push(h);
    else ignored.push(h);
  });

  const rows = [];
  let truncated = false;
  for (let i = headerAt + 1; i < grid.length; i += 1) {
    if (rows.length >= maxRows) { truncated = true; break; }
    const cells = grid[i] || [];
    const row = {};
    fieldByCol.forEach((field, idx) => {
      if (!field) return;
      const raw = cells[idx] == null ? '' : String(cells[idx]).trim();
      if (raw === '') return; // blank ⇒ no change, exactly as in the CSV path
      if (field === 'sku')     { row.sku = cleanCode(raw); return; }
      if (field === 'barcode') { row.barcode = cleanCode(raw, { digitsOnly: true }); return; }
      row[field] = raw;
    });
    // A "Variant" cell wins over per-axis columns; two columns naming the same
    // axis keep the first. Blank axis cells contribute nothing.
    if (!row.__variant) {
      const attrs = {};
      axisByCol.forEach((axis, idx) => {
        if (!axis || axis in attrs) return;
        const raw = cells[idx] == null ? '' : String(cells[idx]).trim();
        if (raw !== '') attrs[axis] = raw;
      });
      if (Object.keys(attrs).length) row.__variant = formatVariantCell(attrs);
    }
    if (row.sku || row.barcode) rows.push(row);
  }

  // Writable VALUE columns only. Barcode is writable but is here to identify the
  // row (a supplier sheet has our barcode and their article number), so counting
  // it would tell the admin this file changes something when it does not.
  const present = new Set(Object.values(fieldByCol).filter(Boolean));
  const importableFields = [...map.writable]
    .filter(f => present.has(f) && !map.identifiers.has(f));
  return { rows, headers, ignored, orderQtyColumns, importableFields, truncated };
}

// ── PDF: labelled identifiers ───────────────────────────────────────────────
//
// A generated purchase order / order confirmation does not put our code in a
// column — the column holds the BUYER's article number, and ours is introduced
// by a label ("Your material number 77005"), with the shared code being the
// GTIN. So a label is stronger evidence than a column position, and on these
// documents the two disagree. (LABEL_SKU / LABEL_BARCODE: salesReport/tradeLabels.)

// Walk the document's lines in order and start a new record whenever a label
// comes round again with a DIFFERENT value — the shape every line-item block
// has. A code must contain a digit, which is what stops a table HEADER
// ("SKU  Description  Price") from being read as "sku = Description".
//
// Repeating the same value inside one block must NOT open a new record: plenty
// of templates print the EAN twice per item (once in the block, once in a
// per-item summary line), and treating the repeat as a boundary shifts every
// later pairing — the next item's SKU then lands in a record holding the
// PREVIOUS item's barcode, and since Barcode is a writable column, applying
// that row would overwrite one product's barcode with another's.
function rowsFromLabels(lines, { maxRows }) {
  const rows = [];
  let current = null;
  let truncated = false;

  const flush = () => {
    if (current && (current.sku || current.barcode)) {
      if (rows.length >= maxRows) truncated = true;
      else rows.push(current);
    }
    current = null;
  };

  // Record `value` under `field`; a repeat of what we already hold is a no-op,
  // a different value ends the current record and starts the next.
  const take = (field, value) => {
    if (!value) return;
    if (current && current[field] === value) return;
    if (current && current[field] != null) flush();
    current = current || {};
    current[field] = value;
  };

  for (const line of lines) {
    if (truncated) break;
    const skuHit = line.match(LABEL_SKU);
    const labelled = skuHit ? stripSentencePunctuation(skuHit[1]) : '';
    if (labelled.length >= 2 && hasDigit(labelled)) take('sku', cleanCode(labelled));
    const barHit = line.match(LABEL_BARCODE);
    if (barHit) {
      const code = cleanCode(barHit[1], { digitsOnly: true });
      // Over-length means two codes were glued onto one line by the page
      // geometry; an ambiguous read is dropped rather than invented.
      if (code.length >= BARCODE_MIN && code.length <= BARCODE_MAX) take('barcode', code);
    }
  }
  flush();

  return {
    rows, headers: [], ignored: [], orderQtyColumns: [], importableFields: [], truncated,
  };
}

// ── dispatch ────────────────────────────────────────────────────────────────

const KIND_XLSX = 'xlsx';
const KIND_PDF  = 'pdf';
const KIND_CSV  = 'csv';

// Extension first (the upload filter already vetted it), MIME as the fallback.
function detectKind(file) {
  const name = String(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '');
  if (/\.pdf$/.test(name) || mime === 'application/pdf') return KIND_PDF;
  if (/\.(xlsx|xls)$/.test(name)
    || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || mime === 'application/vnd.ms-excel') return KIND_XLSX;
  if (/\.(csv|txt)$/.test(name) || /csv|text\/plain/.test(mime)) return KIND_CSV;
  // An octet-stream with an unhelpful name: sniff the container.
  const head = file.buffer.subarray(0, 5);
  if (head[0] === 0x50 && head[1] === 0x4b) return KIND_XLSX;
  if (head.toString('latin1').startsWith('%PDF-')) return KIND_PDF;
  return null;
}

/**
 * Parse one uploaded product-import file.
 * `file`    — the multer memory file ({ buffer, originalname, mimetype }).
 * `columns` — PRODUCT_CSV_COLUMNS, so canonical headers cannot drift.
 * → { source, rows, headers, ignored, orderQtyColumns, importableFields,
 *     truncated }
 * No sheet name: parseXlsxBuffer concatenates every worksheet, so a workbook
 * has no single sheet to report.
 * Throws ProductImportParseError, whose `reason` the controller maps to a message.
 */
async function parseProductImportFile(file, { columns, maxRows = 5000 } = {}) {
  if (!file || !file.buffer || !file.buffer.length) throw new ProductImportParseError('empty');
  const map  = buildHeaderMap(columns);
  const kind = detectKind(file);
  if (!kind) throw new ProductImportParseError('unsupportedType');

  let parsed;

  if (kind === KIND_XLSX) {
    let grid;
    try {
      grid = await parseXlsxBuffer(file.buffer);
    } catch (err) {
      // A legacy binary .xls or a corrupt workbook fails ExcelJS — a clean 400,
      // same as the order-import parse-file route.
      throw new ProductImportParseError('unreadable', { cause: err });
    }
    // parseXlsxBuffer has already found a header row for its own purposes; pass
    // it back in as row 0 so nothing is lost if it picked a different one.
    parsed = rowsFromGrid([grid.headers, ...grid.rows], map, { maxRows });
  } else if (kind === KIND_PDF) {
    let grid;
    try {
      grid = await parsePdfBuffer(file.buffer);
    } catch (err) {
      throw new ProductImportParseError('unreadable', { cause: err });
    }
    const gridRows = [grid.headers, ...grid.rows];
    if (!grid.rows.length && !(grid.headers || []).length) throw new ProductImportParseError('noText');
    // Labels win over column guessing (see the note above rowsFromLabels).
    const lines = gridRows.map(r => (r || []).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const labelled = rowsFromLabels(lines, { maxRows });
    parsed = labelled.rows.length ? labelled : rowsFromGrid(gridRows, map, { maxRows });
  } else {
    // csv-parse, not the order-import grid helper: that one splits on newlines
    // before it splits cells, so a quoted cell containing a line break is torn
    // into two rows (verified: a Name with a line break loses the row's Stock
    // value and leaves a bogus row behind). This is now the ONLY CSV reader —
    // the browser used to have its own, with exactly that newline-first flaw.
    let records;
    try {
      records = parseCsvSync(file.buffer, {
        bom: true,
        columns: false,
        relax_column_count: true,
        relax_quotes: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (err) {
      throw new ProductImportParseError('unreadable', { cause: err });
    }
    parsed = rowsFromGrid(records.map(r => r.map(c => String(c == null ? '' : c))), map, { maxRows });
  }

  if (!parsed) throw new ProductImportParseError('noIdentifierColumn');
  if (!parsed.rows.length) throw new ProductImportParseError('noRows');
  return { source: kind, ...parsed };
}

module.exports = {
  parseProductImportFile,
  ProductImportParseError,
  // exported for the unit tests
  rowsFromGrid,
  rowsFromLabels,
  detectKind,
  cleanCode,
  stripSentencePunctuation,
  BARCODE_MIN,
  BARCODE_MAX,
  KIND_XLSX,
  KIND_PDF,
  KIND_CSV,
};
