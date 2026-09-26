// Goods receiving — Vörumóttaka (admin view 'receiving';
// harvest2-lane6a-2026-09-26, ported from icelandicstore #23).
// Mounted at /api/v1/admin/receiving. Every write is CSRF-protected; the one
// that moves stock (finalize) goes through Inventory.applyBatch.
//
// Scans get their own limiter instead of app.js's writeLimiter (450 writes /
// 15 min): one scan is one POST, and a delivery of a few hundred units would
// otherwise hit the ceiling half-way through the pallet. The gate is still
// requireAuth + requireView('receiving') + CSRF; the global limiter still
// applies on top. (Invariant 7 exemption, reason: scanning is bursty work.)
const express   = require('express');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const router    = express.Router();

const ctrl             = require('../controllers/adminReceivingController');
const { requireAuth }  = require('../auth/middleware');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');
const { createProductImportUpload } = require('../middleware/upload');

const scanLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? `u:${req.user.id}` : ipKeyGenerator(req.ip)),
  skip: () => process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development',
  message: { error: 'Too many scans, please try again later.', code: 429 },
});

// The supplier's file: the products import's upload (memory only, 10 MB,
// .csv/.xlsx/.pdf) — the same reader reads it.
const receiptFile = (req, res, next) => {
  createProductImportUpload().single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: `Upload error: ${err.message}`, code: tooBig ? 413 : 400 });
    }
    if (err) return res.status(400).json({ error: err.message, code: 400 });
    next();
  });
};

router.use(requireAuth, requireView('receiving'));

router.get('/',                        ctrl.list);
router.post('/',                       csrfProtect, sanitizeBody, ctrl.create);
router.get('/:id',                     ctrl.get);
router.get('/:id/receipt.pdf',         ctrl.receiptPdf);
router.post('/:id/lines/import',       csrfProtect, receiptFile, ctrl.importLines);
router.patch('/:id/lines/:lineId',     csrfProtect, sanitizeBody, ctrl.updateLine);
router.post('/:id/scan',               scanLimiter, csrfProtect, sanitizeBody, ctrl.scan);
router.delete('/:id/scans/:scanId',    csrfProtect, ctrl.deleteScan);
router.post('/:id/finalize',           csrfProtect, sanitizeBody, ctrl.finalize);
router.post('/:id/cancel',             csrfProtect, ctrl.cancel);

module.exports = router;
