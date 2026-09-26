// Goods receiving — Vörumóttaka (harvest2-lane6a-2026-09-26; ported from
// icelandicstore #23, adminGoodsReceiptController.js). A delivery is checked
// in against the supplier's own file:
//   1. create a draft receipt (supplier, reference);
//   2. read the supplier's lines from a .csv/.xlsx/.pdf through the ONE
//      product-file reader (services/productImport/parseFile.js, with a
//      receipt column table below) — matched to our catalogue by SKU, then
//      barcode, never guessed;
//   3. scan the goods in (ScanInput; each scan resolves by code);
//   4. see shorts / overs / not-on-invoice, re-match or skip lines;
//   5. finalise → ONE audited Inventory.applyBatch increment (reason
//      'receipt', the receipt on every row), refused a second time;
//   6. the receipt as a PDF (services/pdfService.js).
// Mounted at /api/v1/admin/receiving behind requireView('receiving').
const logger       = require('../logger');
const GoodsReceipt = require('../models/GoodsReceipt');
const Inventory    = require('../models/Inventory');
const Product      = require('../models/Product');
const Setting      = require('../models/Setting');
const { parseProductImportFile, ProductImportParseError } = require('../services/productImport/parseFile');
const { streamGoodsReceipt } = require('../services/pdfService');
const { respondStockError } = require('./adminInventoryController');
const { t } = require('../i18n');

// The receipt's column vocabulary for the shared reader. Canonical headers
// win over the reader's product synonyms, so an ORDER quantity ("Qty",
// "Magn", "Order quantity" …) — which the products import deliberately never
// reads as stock — is exactly the expected quantity here. SKU and barcode
// keep the reader's own supplier synonyms ("Item no", "EAN" …).
const RECEIPT_COLUMNS = [
  ['SKU', 'sku', 'str'], ['Barcode', 'barcode', 'str'],
  ['Description', 'description', 'str'], ['Name', 'description', 'str'], ['Product', 'description', 'str'],
  ['Lýsing', 'description', 'str'], ['Heiti', 'description', 'str'], ['Vara', 'description', 'str'],
  ['Supplier ref', 'supplier_ref', 'str'], ['Supplier code', 'supplier_ref', 'str'],
  ['Quantity', 'qty', 'int'], ['Qty', 'qty', 'int'], ['Order quantity', 'qty', 'int'], ['Order qty', 'qty', 'int'],
  ['Ordered quantity', 'qty', 'int'], ['Delivered quantity', 'qty', 'int'], ['Shipped quantity', 'qty', 'int'],
  ['Pcs', 'qty', 'int'], ['Units', 'qty', 'int'], ['Magn', 'qty', 'int'], ['Fjöldi', 'qty', 'int'],
  ['Pöntunarmagn', 'qty', 'int'],
  ['Unit cost', 'unit_cost', 'int'], ['Unit price', 'unit_cost', 'int'], ['Cost', 'unit_cost', 'int'],
  ['Einingaverð', 'unit_cost', 'int'], ['Kostnaðarverð', 'unit_cost', 'int'], ['Innkaupsverð', 'unit_cost', 'int'],
];

// ProductImportParseError.reason → the products import's own messages.
const PARSE_MESSAGES = {
  empty:              'errors.admin.importFileRequired',
  unsupportedType:    'errors.admin.importUnsupportedFile',
  unreadable:         'errors.admin.importUnreadableFile',
  noText:             'errors.admin.importPdfNoText',
  noIdentifierColumn: 'errors.admin.importNoIdentifierColumn',
  noRows:             'errors.admin.importNoDataRows',
};

// GoodsReceipt's typed errors → status + message key.
const RECEIPT_ERRORS = {
  RECEIPT_NOT_FOUND: 'errors.receiving.notFound',
  ALREADY_FINALIZED: 'errors.receiving.alreadyFinalized',
  RECEIPT_CLOSED:    'errors.receiving.closed',
  LINE_NOT_FOUND:    'errors.receiving.lineNotFound',
  PRODUCT_NOT_FOUND: 'errors.admin.productNotFound',
  VARIANT_REQUIRED:  'errors.receiving.variantRequired',
  SCAN_NOT_FOUND:    'errors.receiving.scanNotFound',
  INCOMPLETE:        'errors.receiving.incomplete',
  TOO_MANY_LINES:    'errors.receiving.tooManyLines',
  NO_LINES:          'errors.admin.importNoDataRows',
};

async function respond(req, res, err) {
  // A product or variant removed between the match and the write fails its
  // foreign key: the catalogue changed under the page, not a server fault.
  if (err && err.code === '23503') {
    return res.status(409).json({ error: t(req.locale, 'errors.receiving.itemChanged'), code: 409, reason: 'ITEM_CHANGED' });
  }
  const key = err && err.status && RECEIPT_ERRORS[err.code];
  if (key) {
    return res.status(err.status).json({
      error: t(req.locale, key, { n: (err.lineIds || []).length, max: err.max || GoodsReceipt.MAX_LINES }),
      code: err.status, reason: err.code,
      ...(err.lineIds ? { lineIds: err.lineIds } : {}),
    });
  }
  if (await respondStockError(req, res, err)) return undefined;
  throw err;
}

// A quantity cell as a supplier writes it: "12", "12,0", "1 200". Whole and
// ≥ 0, else null (the line keeps 0 expected and a person fixes it).
function cellInt(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n) && n <= Inventory.MAX_STOCK_VALUE ? n : null;
}
function cellMoney(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? Math.round(n) : null;
}
const clip = (v, n) => (v == null ? null : (String(v).trim().slice(0, n) || null));

const adminReceivingController = {
  // GET / [?status=draft|finalized|cancelled] → { receipts }
  async list(req, res, next) {
    try {
      const status = GoodsReceipt.STATUSES.includes(req.query.status) ? req.query.status : null;
      return res.json({ receipts: await GoodsReceipt.list({ status }) });
    } catch (err) { return next(err); }
  },

  // POST / { supplierName, reference?, note? } → 201 { receipt }
  async create(req, res, next) {
    try {
      const b = req.body || {};
      const supplierName = typeof b.supplierName === 'string' ? b.supplierName.trim() : '';
      if (!supplierName || supplierName.length > 200) {
        return res.status(400).json({ error: t(req.locale, 'errors.receiving.supplierRequired'), code: 400 });
      }
      for (const [field, max] of [['reference', 100], ['note', 1000]]) {
        if (b[field] != null && (typeof b[field] !== 'string' || b[field].length > max)) {
          return res.status(400).json({ error: t(req.locale, 'errors.receiving.fieldTooLong', { max }), code: 400 });
        }
      }
      const receipt = await GoodsReceipt.create({
        supplierName, reference: clip(b.reference, 100), note: clip(b.note, 1000),
        createdBy: req.user ? req.user.id : null,
      });
      return res.status(201).json({ receipt });
    } catch (err) { return next(err); }
  },

  // GET /search?q= → { items } — the line matcher's picker, behind this view
  // (a receiving-only role has no `inventory` view to search through).
  async search(req, res, next) {
    try {
      const q = String(req.query.q == null ? '' : req.query.q).trim().slice(0, 200);
      if (!q) return res.json({ items: [] });
      return res.json({ items: await Inventory.searchItems(q, { limit: 20 }) });
    } catch (err) { return next(err); }
  },

  // GET /:id → { receipt, lines, extras, scans, summary }
  async get(req, res, next) {
    try {
      const state = await GoodsReceipt.state(req.params.id);
      if (!state) return res.status(404).json({ error: t(req.locale, 'errors.receiving.notFound'), code: 404 });
      return res.json(state);
    } catch (err) { return next(err); }
  },

  // POST /:id/lines/import (multipart, field `file`) → the new state plus
  // { imported: { added, matched, skippedColumns, truncated } }. Read in
  // memory and never stored.
  async importLines(req, res, next) {
    try {
      if (!req.file) return res.status(400).json({ error: t(req.locale, 'errors.admin.importFileRequired'), code: 400 });
      let parsed;
      try {
        parsed = await parseProductImportFile(req.file, { columns: RECEIPT_COLUMNS, maxRows: GoodsReceipt.MAX_LINES });
      } catch (err) {
        if (!(err instanceof ProductImportParseError)) throw err;
        logger.warn({
          reason: err.reason, filename: String(req.file.originalname || '').slice(0, 120),
          mimetype: req.file.mimetype, size: req.file.size,
          cause: err.cause ? { name: err.cause.name, message: err.cause.message } : null,
        }, 'goods receipt: file not readable');
        return res.status(400).json({
          error: t(req.locale, PARSE_MESSAGES[err.reason] || 'errors.admin.importUnreadableFile'),
          code: 400, reason: err.reason,
        });
      }
      const rows = parsed.rows.map(r => ({
        sku: clip(r.sku, 100),
        barcode: clip(r.barcode, 50),
        description: clip(r.description || r.name, 300),
        supplierRef: clip(r.supplier_ref, 100),
        expectedQty: cellInt(r.qty) || 0,
        unitCost: cellMoney(r.unit_cost),
      }));
      try {
        const out = await GoodsReceipt.addLines(req.params.id, rows);
        const state = await GoodsReceipt.state(req.params.id);
        return res.json({
          ...state,
          imported: { ...out, ignoredColumns: parsed.ignored || [], truncated: Boolean(parsed.truncated) },
        });
      } catch (err) { return await respond(req, res, err); }
    } catch (err) { return next(err); }
  },

  // PATCH /:id/lines/:lineId { productId?, variantId?, matchStatus?, expectedQty? }
  async updateLine(req, res, next) {
    try {
      const b = req.body || {};
      const patch = {};
      if (b.productId !== undefined) {
        if (b.productId !== null && b.productId !== '' && typeof b.productId !== 'string') {
          return res.status(400).json({ error: t(req.locale, 'errors.admin.productNotFound'), code: 400 });
        }
        patch.productId = b.productId || null;
        patch.variantId = typeof b.variantId === 'string' && b.variantId ? b.variantId : null;
      }
      if (b.matchStatus !== undefined) {
        if (!['matched', 'unmatched', 'skipped'].includes(b.matchStatus)) {
          return res.status(400).json({ error: t(req.locale, 'errors.receiving.lineStatusInvalid'), code: 400 });
        }
        patch.matchStatus = b.matchStatus;
      }
      if (b.expectedQty !== undefined) {
        if (!Inventory.isWholeCount(b.expectedQty)) {
          return res.status(400).json({ error: t(req.locale, 'errors.receiving.qtyInvalid'), code: 400 });
        }
        patch.expectedQty = Number(b.expectedQty);
      }
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: t(req.locale, 'errors.receiving.lineStatusInvalid'), code: 400 });
      }
      try {
        await GoodsReceipt.updateLine(req.params.id, req.params.lineId, patch);
        return res.json(await GoodsReceipt.state(req.params.id));
      } catch (err) { return await respond(req, res, err); }
    } catch (err) { return next(err); }
  },

  // POST /:id/scan { code, qty? } → the new state plus { scanned: { item,
  // matched, qty } }. The code resolves like the count screen's: a product-
  // level code on a product WITH variants is refused (scan the variant).
  async scan(req, res, next) {
    try {
      const b = req.body || {};
      const code = typeof b.code === 'string' ? b.code.trim().slice(0, 200) : '';
      if (!code) return res.status(400).json({ error: t(req.locale, 'errors.inventory.codeRequired'), code: 400 });
      let qty = 1;
      if (b.qty != null && b.qty !== '') {
        if (!Inventory.isWholeCount(b.qty) || Number(b.qty) < 1 || Number(b.qty) > GoodsReceipt.MAX_SCAN_QTY) {
          return res.status(400).json({ error: t(req.locale, 'errors.receiving.qtyInvalid'), code: 400 });
        }
        qty = Number(b.qty);
      }
      const hit = await Product.resolveByCode(code);
      if (!hit) return res.status(422).json({ error: t(req.locale, 'errors.inventory.codeNotFound', { code }), code: 422, reason: 'NOT_FOUND' });
      const [item] = await Inventory.stockItems([{ productId: hit.productId, variantId: hit.variantId }]);
      if (!item || item.variant_required) {
        return res.status(422).json({ error: t(req.locale, 'errors.receiving.variantRequired'), code: 422, reason: 'VARIANT_REQUIRED' });
      }
      try {
        const out = await GoodsReceipt.addScan(req.params.id, {
          code, productId: item.product_id, variantId: item.variant_id, qty, scannedBy: req.user ? req.user.id : null,
        });
        const state = await GoodsReceipt.state(req.params.id);
        return res.json({ ...state, scanned: { item, matched: out.matched, qty } });
      } catch (err) { return await respond(req, res, err); }
    } catch (err) { return next(err); }
  },

  // DELETE /:id/scans/:scanId → the new state
  async deleteScan(req, res, next) {
    try {
      try {
        await GoodsReceipt.deleteScan(req.params.id, req.params.scanId);
        return res.json(await GoodsReceipt.state(req.params.id));
      } catch (err) { return await respond(req, res, err); }
    } catch (err) { return next(err); }
  },

  // POST /:id/finalize { excludeExtras?: ["productId|variantId"] } → the new
  // state plus { finalized: { batchId, units, lines } }. Refused (409) when
  // already finalised, cancelled, a counted line is unmatched, or the stock
  // batch is refused — in every case nothing moved.
  async finalize(req, res, next) {
    try {
      const raw = (req.body || {}).excludeExtras;
      if (raw != null && (!Array.isArray(raw) || raw.length > 2000 || raw.some(k => typeof k !== 'string'))) {
        return res.status(400).json({ error: t(req.locale, 'errors.receiving.lineStatusInvalid'), code: 400 });
      }
      try {
        const out = await GoodsReceipt.finalize(req.params.id, {
          userId: req.user ? req.user.id : null, excludeExtras: raw || [],
        });
        const state = await GoodsReceipt.state(req.params.id);
        return res.json({ ...state, finalized: out });
      } catch (err) { return await respond(req, res, err); }
    } catch (err) { return next(err); }
  },

  // POST /:id/cancel → the new state (a draft only; nothing moved).
  async cancel(req, res, next) {
    try {
      try {
        await GoodsReceipt.cancel(req.params.id);
        return res.json(await GoodsReceipt.state(req.params.id));
      } catch (err) { return await respond(req, res, err); }
    } catch (err) { return next(err); }
  },

  // GET /:id/receipt.pdf — the receipt, any status (a draft prints as a
  // check list). Plain GET with the session cookie, like the delivery note.
  async receiptPdf(req, res, next) {
    try {
      const receipt = await GoodsReceipt.findById(req.params.id);
      if (!receipt) return res.status(404).json({ error: t(req.locale, 'errors.receiving.notFound'), code: 404 });
      const [lines, extras, store] = await Promise.all([
        GoodsReceipt.lines(receipt.id), GoodsReceipt.extras(receipt.id), Setting.getGeneralSettings(),
      ]);
      return streamGoodsReceipt({ res, receipt, lines, extras, store });
    } catch (err) { return next(err); }
  },
};

adminReceivingController.RECEIPT_COLUMNS = RECEIPT_COLUMNS;
module.exports = adminReceivingController;
