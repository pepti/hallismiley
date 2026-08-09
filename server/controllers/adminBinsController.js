// BIN System controller — the visual warehouse-stock board (admin view 'bins').
// Mounted under requireAuth + requireView('bins') (server/routes/adminBinsRoutes).
// Read endpoints feed the board/grid/detail panel; the single write relocates an
// item between bins. Consistent error envelope: { error, code }.
const Bin = require('../models/Bin');
const Product = require('../models/Product');
const { t } = require('../i18n');

const adminBinsController = {
  // Zone chips + headline summary (total bins/items, queue, mismatches).
  async board(req, res, next) {
    try { return res.json(await Bin.board()); }
    catch (err) { next(err); }
  },

  // The grid (cells with occupied/multi/free) for one zone.
  async zone(req, res, next) {
    try { return res.json(await Bin.zone(req.params.zone)); }
    catch (err) { next(err); }
  },

  // The products/variants stored in one exact bin (detail panel).
  async items(req, res, next) {
    try {
      const bin = req.params.bin;
      return res.json({ bin, items: await Bin.itemsInBin(bin) });
    } catch (err) { next(err); }
  },

  // Exact scan resolve: a SKU/barcode → the item (and where it lives).
  async lookup(req, res, next) {
    try {
      const code = (req.query.code || '').toString().trim();
      if (!code) return res.status(400).json({ error: t(req.locale, 'errors.bins.codeRequired'), code: 400 });
      const item = await Product.resolveByCode(code);
      if (!item) return res.status(404).json({ error: t(req.locale, 'errors.bins.notFound', { code }), code: 404 });
      return res.json({ item });
    } catch (err) { next(err); }
  },

  // Fuzzy search across name / sku / barcode / bin for the search box.
  async search(req, res, next) {
    try {
      const q = (req.query.q || '').toString().trim();
      if (!q) return res.json({ results: [] });
      return res.json({ results: await Bin.search(q) });
    } catch (err) { next(err); }
  },

  // Active items with no bin yet (Queue badge list).
  async queue(req, res, next) {
    try { return res.json({ items: await Bin.queue() }); }
    catch (err) { next(err); }
  },

  // Items whose bin code is malformed (Mismatches badge list).
  async mismatches(req, res, next) {
    try { return res.json({ items: await Bin.mismatches() }); }
    catch (err) { next(err); }
  },

  // Relocate one product/variant to a new bin (empty clears the assignment).
  async move(req, res, next) {
    try {
      const { productId = null, variantId = null, bin } = req.body || {};
      if (!productId && !variantId) {
        return res.status(400).json({ error: t(req.locale, 'errors.bins.itemNotFound'), code: 400 });
      }
      // Validate + normalise the target. Empty clears; otherwise it must fit the
      // bin convention and is stored upper-cased so zones stay consistent.
      const raw = bin == null ? '' : String(bin).trim();
      if (raw !== '' && !Bin.parseBin(raw)) {
        return res.status(400).json({ error: t(req.locale, 'errors.bins.invalidBin'), code: 400 });
      }
      const value = raw === '' ? null : raw.toUpperCase();
      const item = await Bin.move({ productId, variantId, bin: value });
      if (!item) return res.status(404).json({ error: t(req.locale, 'errors.bins.itemNotFound'), code: 404 });
      return res.json({ item });
    } catch (err) { next(err); }
  },
};

module.exports = adminBinsController;
