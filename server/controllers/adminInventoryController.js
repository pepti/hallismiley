// Inventory Watch + stock count (harvest2-lane6a-2026-09-26).
//
//   GET  /api/v1/admin/shop/reports/inventory   the watch report (ice #13)
//   PATCH /api/v1/admin/inventory/stock         "Fix stock" (ice #13, #15)
//   GET  /api/v1/admin/inventory/lookup?code=   scan resolve for the count
//   GET  /api/v1/admin/inventory/search?q=      picker search for the count
//   POST /api/v1/admin/inventory/count          one audited batch (ice #18)
//
// Every route sits behind requireView('inventory') (adminInventoryRoutes.js,
// and the one report route in adminShopRoutes.js). Every stock write goes
// through models/Inventory.js — `correct` (setAbsolute under the row locks)
// and `applyBatch` — so each movement leaves an inventory_adjustments row
// with the actor and the reason, and the engine's stock >= 0 CHECK is never
// reached as a 500: a batch that would go below zero is refused whole, with
// every offending line named.
const Inventory = require('../models/Inventory');
const Product   = require('../models/Product');
const { buildWatchReport, WINDOW_DAYS } = require('../utils/inventoryStatus');
const { t } = require('../i18n');

const MAX_NOTE = 500;
const MAX_CODE = 200;

function actorId(req) { return (req.user && req.user.id) || null; }

function bad(req, res, key, params = {}, extra = {}) {
  return res.status(400).json({ error: t(req.locale, key, params), code: 400, ...extra });
}

function attrLabel(attributes) {
  if (!attributes || typeof attributes !== 'object') return '';
  return Object.values(attributes).filter(v => v != null && String(v).trim()).join(' / ');
}

function itemName(item) {
  if (!item) return '';
  const attrs = attrLabel(item.attributes);
  return attrs ? `${item.name} — ${attrs}` : String(item.name || '');
}

// The typed refusals of models/Inventory.js (and GoodsReceipt finalise, which
// calls applyBatch) → the error envelope. Returns true when it answered.
async function respondStockError(req, res, err) {
  if (!err) return false;
  if (err.code === 'BATCH_INVALID') {
    const line = err.index >= 0 ? err.index + 1 : null;
    const key = err.why === 'empty' ? 'errors.inventory.batchEmpty'
      : err.why === 'tooMany' ? 'errors.inventory.batchTooMany'
        : err.why === 'duplicate' ? 'errors.inventory.batchDuplicateLine'
          : 'errors.inventory.batchLineInvalid';
    res.status(400).json({
      error: t(req.locale, key, { line, max: Inventory.BATCH_MAX_LINES }),
      code: 400, reason: 'BATCH_INVALID', line,
    });
    return true;
  }
  if (err.code === 'BATCH_REFUSED') {
    const refs = (err.lines || []).map(l => ({ productId: l.productId, variantId: l.variantId }));
    let named = [];
    try { named = await Inventory.stockItems(refs); } catch { /* names are decoration */ }
    const nameOf = (l) => {
      const hit = named.find(n => String(n.product_id) === String(l.productId)
        && String(n.variant_id || '') === String(l.variantId || ''));
      return itemName(hit);
    };
    const lines = (err.lines || []).map(l => ({
      index: l.index, line: l.index + 1, productId: l.productId, variantId: l.variantId,
      name: nameOf(l), reason: l.reason, onHand: l.onHand, mode: l.mode, qty: l.qty, result: l.result,
      message: l.reason === 'VARIANT_REQUIRED'
        ? t(req.locale, 'errors.inventory.variantRequired', { name: nameOf(l) })
        : t(req.locale, 'errors.inventory.belowZero', { name: nameOf(l), onHand: l.onHand, result: l.result }),
    }));
    const onlyNegative = lines.every(l => l.reason === 'NEGATIVE');
    res.status(409).json({
      error: t(req.locale, 'errors.inventory.batchRefused', { n: lines.length }),
      code: 409, reason: onlyNegative ? 'INSUFFICIENT_STOCK' : 'BATCH_REFUSED', lines,
    });
    return true;
  }
  if (err.code === 'LINE_NOT_FOUND') {
    const line = Number.isInteger(err.index) ? err.index + 1 : null;
    res.status(404).json({ error: t(req.locale, 'errors.admin.productNotFound'), code: 404, line });
    return true;
  }
  if (err.code === 'DUPLICATE_BATCH') {
    res.status(409).json({ error: t(req.locale, 'errors.inventory.duplicateBatch'), code: 409, reason: 'DUPLICATE_BATCH' });
    return true;
  }
  return false;
}

const adminInventoryController = {
  // GET /api/v1/admin/shop/reports/inventory → { report: { items, counts,
  // total, window_days } }. The whole stocked catalogue in one payload; the
  // page filters and sorts it client-side (ice #13). One item per product
  // without variants and per active variant.
  async getInventoryReport(req, res, next) {
    try {
      const rows = await Inventory.watchRows({ windowDays: WINDOW_DAYS });
      return res.json({ report: buildWatchReport(rows, { windowDays: WINDOW_DAYS }) });
    } catch (err) { return next(err); }
  },

  // PATCH /api/v1/admin/inventory/stock { productId, variantId?, stock, reason,
  // note? } — set one unit's on hand to the counted figure. Strict body
  // (ice #15): stock must be a real number or a numeric string, a whole
  // number 0..MAX_STOCK_VALUE (the engine keeps stock >= 0), the reason one of
  // Inventory.ADJUSTMENT_REASONS.
  async correctStock(req, res, next) {
    try {
      const b = req.body || {};
      const productId = typeof b.productId === 'string' ? b.productId.trim() : '';
      const variantId = (typeof b.variantId === 'string' && b.variantId.trim()) ? b.variantId.trim() : null;
      if (!productId) return bad(req, res, 'errors.admin.productNotFound');
      if (b.variantId != null && b.variantId !== '' && typeof b.variantId !== 'string') {
        return bad(req, res, 'errors.admin.productNotFound');
      }
      if (!Inventory.isWholeCount(b.stock)) {
        const n = Number(b.stock);
        return (Number.isInteger(n) && n > Inventory.MAX_STOCK_VALUE && typeof b.stock !== 'boolean')
          ? bad(req, res, 'errors.inventory.stockRange', { max: Inventory.MAX_STOCK_VALUE })
          : bad(req, res, 'errors.inventory.stockInvalid');
      }
      if (!Inventory.ADJUSTMENT_REASONS.includes(b.reason)) return bad(req, res, 'errors.inventory.reasonInvalid');
      if (b.note != null && b.note !== '' && (typeof b.note !== 'string' || b.note.length > MAX_NOTE)) {
        return bad(req, res, 'errors.inventory.noteTooLong', { n: MAX_NOTE });
      }
      const note = (typeof b.note === 'string' && b.note.trim()) ? b.note.trim() : null;
      try {
        const out = await Inventory.correct({
          productId, variantId, target: Number(b.stock), reason: b.reason, note, userId: actorId(req),
        });
        const [item] = await Inventory.stockItems([{ productId, variantId }]);
        return res.json({ ...out, item: item || null });
      } catch (err) {
        if (await respondStockError(req, res, err)) return undefined;
        throw err;
      }
    } catch (err) { return next(err); }
  },

  // GET /api/v1/admin/inventory/lookup?code= → { items, variantRequired }.
  // A variant's code gives that variant; a product-level code on a product
  // WITH variants gives its active variants and variantRequired: true (the
  // screen asks which one — a product-level count would move a number the
  // shop never reads).
  async lookup(req, res, next) {
    try {
      const code = String(req.query.code == null ? '' : req.query.code).trim().slice(0, MAX_CODE);
      if (!code) return bad(req, res, 'errors.inventory.codeRequired');
      const hit = await Product.resolveByCode(code);
      if (!hit) return res.status(404).json({ error: t(req.locale, 'errors.inventory.codeNotFound', { code }), code: 404 });
      const [item] = await Inventory.stockItems([{ productId: hit.productId, variantId: hit.variantId }]);
      if (item && item.variant_required) {
        const items = await Inventory.stockItems(await Inventory.variantRefs(hit.productId));
        return res.json({ items, variantRequired: true });
      }
      return res.json({ items: item ? [item] : [], variantRequired: false });
    } catch (err) { return next(err); }
  },

  // GET /api/v1/admin/inventory/search?q= → { items } (stocked units only).
  async search(req, res, next) {
    try {
      const q = String(req.query.q == null ? '' : req.query.q).trim().slice(0, MAX_CODE);
      if (!q) return res.json({ items: [] });
      return res.json({ items: await Inventory.searchItems(q, { limit: 20 }) });
    } catch (err) { return next(err); }
  },

  // POST /api/v1/admin/inventory/count { lines: [{ productId, variantId?,
  // mode, qty }], reason?, note?, clientToken? } — the stock count, saved as
  // ONE audited batch (Inventory.applyBatch): every line moves or none does.
  // `clientToken` (the page makes one per count) makes a re-sent save a 409
  // DUPLICATE_BATCH instead of a second movement. → { batchId, results }.
  async applyCount(req, res, next) {
    try {
      const b = req.body || {};
      const reason = b.reason == null || b.reason === '' ? 'recount' : b.reason;
      if (!Inventory.ADJUSTMENT_REASONS.includes(reason)) return bad(req, res, 'errors.inventory.reasonInvalid');
      if (b.note != null && b.note !== '' && (typeof b.note !== 'string' || b.note.length > MAX_NOTE)) {
        return bad(req, res, 'errors.inventory.noteTooLong', { n: MAX_NOTE });
      }
      let clientToken = null;
      if (b.clientToken != null && b.clientToken !== '') {
        if (typeof b.clientToken !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(b.clientToken)) {
          return bad(req, res, 'errors.inventory.batchLineInvalid', { line: '' });
        }
        clientToken = `count:${b.clientToken}`;
      }
      // Per-line reasons are not taken from the body: one count, one reason.
      const lines = Array.isArray(b.lines)
        ? b.lines.map(l => (l && typeof l === 'object'
          ? { productId: l.productId, variantId: l.variantId, mode: l.mode, qty: l.qty } : l))
        : b.lines;
      try {
        const out = await Inventory.applyBatch(lines, {
          userId: actorId(req), reason, note: typeof b.note === 'string' ? b.note : null, clientToken,
        });
        return res.json(out);
      } catch (err) {
        if (await respondStockError(req, res, err)) return undefined;
        throw err;
      }
    } catch (err) { return next(err); }
  },
};

adminInventoryController.respondStockError = respondStockError;
module.exports = adminInventoryController;
