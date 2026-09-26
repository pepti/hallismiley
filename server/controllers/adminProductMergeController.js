'use strict';

// Products → Duplicates: the suggestions (read-only) and the merge itself.
// Ported from icelandicstore #309/#311/#312 (their handlers lived in
// adminShopController; here they are their own file so the shop controller is
// not touched by a feature it does not own). Mounted under
// /api/v1/admin/shop/products/… by routes/adminShopRoutes.js, so every handler
// is behind requireAuth + requireView('products'); the merge also behind CSRF.
const ProductMerge = require('../models/ProductMerge');
const Product = require('../models/Product');
const mergeEngine = require('../services/productMerge/engine');
const { t } = require('../i18n');
const { hasRole } = require('../auth/roles');
const logger = require('../logger');

// A merge error → the standard envelope. Everything else goes to next().
function mergeErrorResponse(err, req, res) {
  const send = (status, key, extra = {}) =>
    res.status(status).json({ error: t(req.locale, key), code: status, ...extra });
  switch (err && err.code) {
    case 'MERGE_BAD_REQUEST':
      return send(err.reason === 'master_not_found' || err.reason === 'source_not_found' ? 404 : 400,
        'errors.admin.mergeBadRequest', { reason: err.reason, ...(err.ids ? { ids: err.ids } : {}) });
    case 'MERGE_REFUSED':
      return send(409, 'errors.admin.mergeRefused', { reason: 'merge_refused', refusals: err.refusals || [] });
    case 'STALE_PREVIEW':
      return send(409, 'errors.admin.mergeStale', { reason: 'stale_preview' });
    case 'MERGE_BUSY':
      res.set('Retry-After', '5');
      return send(409, 'errors.admin.mergeBusy', { reason: 'merge_busy', retryable: true });
    case 'SCHEMA_DRIFT':
      // A table gained a product FK that repointSpec has no policy for: merging
      // is off until it gets one (never leave rows behind on a merged product).
      logger.error({ missing: err.missing }, 'product merge: schema drift — merging switched off');
      return send(503, 'errors.admin.mergeUnavailable', { reason: 'schema_drift' });
    default:
      return null;
  }
}

module.exports = {
  // GET /products/duplicates → { groups }
  async getProductDuplicates(req, res, next) {
    try {
      const groups = await ProductMerge.findDuplicateGroups();
      return res.json({ groups });
    } catch (err) { return next(err); }
  },

  // POST /products/merge/preview { master, ids, variant_map? } → the plan.
  // Read-only (it writes nothing), but a POST with a body, so CSRF-checked.
  async previewProductMerge(req, res, next) {
    try {
      return res.json(await mergeEngine.preview(req.body || {}));
    } catch (err) {
      if (mergeErrorResponse(err, req, res)) return undefined;
      return next(err);
    }
  },

  // POST /products/merge { master, ids, variant_map, expect } → the result.
  // ADMIN ONLY (the tighten-never-loosen default, 2026-09-26; Halli may
  // loosen): a merge cannot be undone except by a point-in-time restore, so
  // the `products` view alone may see the suggestions and preview a plan, but
  // only an administrator runs the transaction — checked on the session's role
  // set, as the customer-email gate (adminCustomerController) does.
  async mergeProducts(req, res, next) {
    if (!hasRole(req.user, 'admin')) {
      return res.status(403).json({
        error: t(req.locale, 'errors.admin.mergeAdminOnly'), code: 403, reason: 'merge_admin_only',
      });
    }
    try {
      const result = await mergeEngine.apply(req.body || {}, {
        userId: req.user ? req.user.id : null, requestId: req.requestId || null,
      });
      logger.info({ masterId: result.masterId, merged: result.merged, counts: result.counts, ms: result.ms,
        lockWaitMs: result.lockWaitMs }, 'product merge: done');
      return res.json(result);
    } catch (err) {
      if (mergeErrorResponse(err, req, res)) return undefined;
      return next(err);
    }
  },

  // Route guard: a merged product is frozen. Its rows now belong to the
  // survivor; it only exists so its URL can redirect and its history keeps a
  // parent. Any write through its own id is a 409 naming where it went,
  // instead of silently editing a hidden row.
  async refuseMergedProduct(req, res, next) {
    const id = req.params.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(id)) return next();
    try {
      const merged = await Product.mergedInto(id);
      if (merged) {
        return res.status(409).json({
          error: t(req.locale, 'errors.admin.productMerged'), code: 409,
          reason: 'product_merged', movedTo: { id: merged },
        });
      }
      return next();
    } catch (err) { return next(err); }
  },

  _mergeErrorResponse: mergeErrorResponse,
};
