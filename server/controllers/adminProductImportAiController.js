'use strict';

// "Read with AI" in the products import (SHIPS DARK — PRODUCT_IMPORT_AI_ENABLED).
// Ported from icelandicstore #306/#314 (their handlers lived in
// adminShopController; here a file of their own). Mounted under
// /api/v1/admin/shop/products/import/… by routes/adminShopRoutes.js, behind
// requireAuth + requireView('products'); the paid route also behind CSRF, the
// flag (404) and the daily page budget (429) BEFORE multer buffers anything.
const Product = require('../models/Product');
const aiLimits = require('../services/productImport/aiLimits');
const aiExtract = require('../services/productImport/aiExtract');
const { AiBusyError } = require('../services/aiGate');
const { t } = require('../i18n');
const logger = require('../logger');

module.exports = {
  // GET /products/import/ai-config → { enabled, chunkPages, maxPages,
  // maxFilePages, remainingPages }. Always 200: the modal asks on every open,
  // and a 404 would log as a failed request.
  async productImportAiConfig(req, res) {
    const enabled = aiLimits.isEnabled();
    return res.json({
      enabled,
      chunkPages: aiLimits.chunkPages(),
      maxPages: aiLimits.maxPages(),
      maxFilePages: aiLimits.maxFilePages(),
      remainingPages: enabled ? aiLimits.remainingPages(req.user && req.user.id) : 0,
    });
  },

  // Route guards, in order after CSRF: the flag, then the budget. Both answer
  // before multer, so a dark or spent endpoint never buffers a 10 MB upload.
  requireProductImportAi(req, res, next) {
    if (!aiLimits.isEnabled()) {
      return res.status(404).json({ error: t(req.locale, 'errors.admin.importAiNotAvailable'), code: 404 });
    }
    return next();
  },
  requireAiPageBudget(req, res, next) {
    if (aiLimits.remainingPages(req.user && req.user.id) > 0) return next();
    res.set('Retry-After', String(aiLimits.secondsUntilReset()));
    return res.status(429).json({ error: t(req.locale, 'errors.admin.importAiPageBudget'), code: 429, reason: 'pageBudget' });
  },

  // POST /products/import/ai-extract?from=&to=  (multipart: ONE PDF chunk)
  // Count the chunk's pages server-side (422 over the per-request cap, or past
  // the per-file cap), take a product-import slot on the AI gate (429
  // AI_BUSY), charge the pages to today's budgets (429 pageBudget), then read.
  // Rows come back in the import's own shape for /preview — nothing is
  // written. 502 when the model fails (its pages are given back). A client
  // that goes away mid-read is not a server failure: the model call is
  // cancelled and the request ends 499, never a 5xx.
  async productImportAiExtract(req, res, next) {
    const userId = req.user && req.user.id;
    const clientGone = new AbortController();
    res.on('close', () => { if (!res.writableEnded) clientGone.abort(); });
    const endAborted = (stage, extra = {}) => {
      logger.info({ stage, ...extra, requestId: req.requestId || null }, 'product import ai: client aborted');
      res.statusCode = 499;
      if (!res.headersSent && !res.destroyed) res.end();
    };
    try {
      if (!req.file) return res.status(400).json({ error: t(req.locale, 'errors.admin.importFileRequired'), code: 400 });
      const isPdf = /\.pdf$/i.test(req.file.originalname || '') || req.file.mimetype === 'application/pdf';
      if (!isPdf || req.file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.importAiPdfOnly'), code: 400, reason: 'pdfOnly' });
      }
      const max = aiLimits.maxPages();
      let doc;
      try {
        doc = await aiExtract.pdfTextAndPages(req.file.buffer, { maxPages: max });
      } catch (err) {
        logger.warn({ err: err.message, size: req.file.size }, 'product import ai: pdf unreadable');
        return res.status(400).json({ error: t(req.locale, 'errors.admin.importUnreadableFile'), code: 400, reason: 'unreadable' });
      }
      if (!doc.pages) return res.status(400).json({ error: t(req.locale, 'errors.admin.importUnreadableFile'), code: 400, reason: 'unreadable' });
      if (doc.pages > max) {
        return res.status(422).json({ error: t(req.locale, 'errors.admin.importAiTooManyPages', { max }), code: 422, reason: 'tooManyPages', max });
      }
      const from = Math.max(1, parseInt(req.query.from, 10) || 1);
      const fileMax = aiLimits.maxFilePages();
      if (from + doc.pages - 1 > fileMax) {
        return res.status(422).json({ error: t(req.locale, 'errors.admin.importAiFileTooLong', { max: fileMax }), code: 422, reason: 'fileTooLong', max: fileMax });
      }
      if (clientGone.signal.aborted) return endAborted('before_model', { pages: doc.pages });

      if (!aiLimits.acquire()) throw new AiBusyError();
      try {
        const charge = aiLimits.chargePages(userId, doc.pages);
        if (!charge) {
          res.set('Retry-After', String(aiLimits.secondsUntilReset()));
          return res.status(429).json({ error: t(req.locale, 'errors.admin.importAiPageBudget'), code: 429, reason: 'pageBudget' });
        }
        const result = await aiExtract.extractProducts({
          buffer: req.file.buffer, text: doc.text, pages: doc.pages, from,
          lookupInUse: async (codes) => ({ codes: new Set(await Product.findCodesInUse(codes)) }),
          signal: clientGone.signal,
        });
        // Before the null test: a call the abort cancelled returns null, and
        // that is the client leaving, not a 502. Charged pages stay charged.
        if (clientGone.signal.aborted) return endAborted(result ? 'after_model' : 'during_model', { pages: doc.pages });
        if (!result) {
          aiLimits.refundPages(charge);
          return res.status(502).json({ error: t(req.locale, 'errors.admin.importAiFailed'), code: 502 });
        }
        // Counts, tokens and timings only — never the rows (supplier prices, names).
        logger.info({ ...result.meta, userId, requestId: req.requestId || null }, 'product import ai: extracted');
        return res.json({
          rows: result.rows,
          from, to: from + doc.pages - 1, pages: doc.pages,
          truncated: result.meta.truncated,
          remainingPages: aiLimits.remainingPages(userId),
          summary: { rows: result.meta.rows, uncertain: result.meta.uncertain, blankedCodes: result.meta.blankedCodes },
        });
      } finally {
        aiLimits.release();
      }
    } catch (err) { return next(err); }
  },
};
