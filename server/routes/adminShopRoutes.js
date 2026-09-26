const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const adminShop                = require('../controllers/adminShopController');
const { requireAuth }          = require('../auth/middleware');
const { requireView }          = require('../auth/requireView');
const { csrfProtect }          = require('../middleware/csrf');
const { sanitizeBody }         = require('../middleware/sanitize');
const { createProductUpload, createProductImportUpload } = require('../middleware/upload');
const { verifyImageBytes } = require('../middleware/verifyImageBytes');
const { validateVariant }  = require('../middleware/validate');

// Admin shop routes require auth; per-view access is gated by path below, so a
// role can be granted (e.g.) orders-only without products. The product editor's
// "assign collections" (PUT /products/:id/collections) sits under /products.
router.use(requireAuth);
router.use('/products',    requireView('products'));
router.use('/collections', requireView('collections'));
router.use('/reports',     requireView('sales'));
router.use('/orders',      requireView('orders'));

// ── Products ────────────────────────────────────────────────────────────────
router.get('/products',           adminShop.listProducts);
// CSV round-trip — literal paths before /products/:id so they aren't read as ids.
// Preview is read-only (no CSRF); apply mutates (CSRF). Both inherit requireView.
// The 4 MB body is parsed HERE, after requireAuth + requireView('products'),
// the app-level limiters and (apply) the header-based CSRF check — app.js skips
// its global parser for this path. sanitizeBody runs again because the global
// one already ran on an empty body.
const importBody = [express.json({ limit: '4mb' }), sanitizeBody];
router.get('/products/export.csv',      adminShop.exportProducts);
// /import/parse-file takes ONE uploaded .csv/.xlsx/.pdf as multipart (memory
// only, 10 MB) and returns rows for preview/apply — the one reader for every
// product file (harvest-ice-d-2026-09-24). CSRF: it only parses, but it is a
// POST with a body, so it carries the same header check as apply.
const productImportUpload = (req, res, next) => {
  createProductImportUpload().single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: `Upload error: ${err.message}`, code: tooBig ? 413 : 400 });
    }
    if (err) return res.status(400).json({ error: err.message, code: 400 });
    next();
  });
};
router.post('/products/import/parse-file', csrfProtect, productImportUpload, adminShop.parseProductImportFile);
router.post('/products/import/preview', ...importBody, adminShop.previewProductImport);
router.post('/products/import/apply',   csrfProtect, ...importBody, adminShop.applyProductImport);
router.post('/products/bulk',           csrfProtect, adminShop.bulkUpdateProducts);
router.get('/products/:id',       adminShop.getProduct);
router.get('/products/:id/adjustments', adminShop.productAdjustments);
router.post('/products',          csrfProtect, adminShop.createProduct);
router.patch('/products/:id',     csrfProtect, adminShop.updateProduct);
router.delete('/products/:id',    csrfProtect, adminShop.deactivateProduct);

// ── Product images ──────────────────────────────────────────────────────────
// /products/:id/images/reorder must come BEFORE /images/:imageId so Express
// doesn't treat the literal "reorder" as an imageId param.
router.patch('/products/:id/images/reorder',
  csrfProtect, adminShop.reorderImages);

router.post('/products/:id/images',
  csrfProtect,
  (req, res, next) => {
    const upload = createProductUpload(req.params.id);
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}`, code: 400 });
      }
      if (err) return res.status(400).json({ error: err.message, code: 400 });
      next();
    });
  },
  verifyImageBytes,
  adminShop.uploadImage);

router.delete('/products/:id/images/:imageId',
  csrfProtect, adminShop.deleteImage);
// The colour a photo shows (migration 119, ice #182/#265). After /reorder, so
// the literal is never read as an image id.
router.patch('/products/:id/images/:imageId',
  csrfProtect, adminShop.updateImageColor);

// ── Product variants ────────────────────────────────────────────────────────
// Harvest 2 lane 6c (ice #194/#432): validateVariant checks the shape of a
// single row; DELETE really deletes (or archives a variant an order or the
// stock history names); /bulk adds many rows whole or not at all.
router.get('/products/:id/variants',                      adminShop.listVariants);
router.post('/products/:id/variants/bulk',      csrfProtect, adminShop.createVariantsBulk);
router.post('/products/:id/variants',           csrfProtect, validateVariant, adminShop.createVariant);
router.patch('/products/:id/variants/:variantId',  csrfProtect, validateVariant, adminShop.updateVariant);
router.delete('/products/:id/variants/:variantId', csrfProtect, adminShop.deleteVariant);

// ── Collections ───────────────────────────────────────────────────────────────
router.get('/collections',                      adminShop.listCollections);
router.post('/collections',        csrfProtect,  adminShop.createCollection);
router.patch('/collections/:id',   csrfProtect,  adminShop.updateCollection);
router.put('/products/:id/collections', csrfProtect, adminShop.setProductCollections);

// ── Reports ───────────────────────────────────────────────────────────────────
router.get('/reports',            adminShop.salesReport);

// ── Orders ──────────────────────────────────────────────────────────────────
router.get('/orders',             adminShop.listOrders);
router.get('/orders/export.xlsx', adminShop.exportOrders);
// Literal route before /orders/:id so "bulk" isn't captured as an order id.
router.get('/orders/bulk/delivery-notes.pdf', adminShop.getBulkDeliveryNotes);
router.get('/orders/:id',         adminShop.getOrder);
router.get('/orders/:id/delivery-note', adminShop.deliveryNote);
router.patch('/orders/:id/status', csrfProtect, adminShop.updateOrderStatus);
router.patch('/orders/:id/tags',   csrfProtect, adminShop.updateOrderTags);

module.exports = router;
