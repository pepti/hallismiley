const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const adminShop                = require('../controllers/adminShopController');
const productMerge             = require('../controllers/adminProductMergeController');
const productImportAi          = require('../controllers/adminProductImportAiController');
const adminInventory           = require('../controllers/adminInventoryController');
const { requireAuth }          = require('../auth/middleware');
const { requireView }          = require('../auth/requireView');
const { csrfProtect }          = require('../middleware/csrf');
const { sanitizeBody }         = require('../middleware/sanitize');
const { createProductUpload, createProductImportUpload } = require('../middleware/upload');
const { verifyImageBytes } = require('../middleware/verifyImageBytes');

// Admin shop routes require auth; per-view access is gated by path below, so a
// role can be granted (e.g.) orders-only without products. The product editor's
// "assign collections" (PUT /products/:id/collections) sits under /products.
router.use(requireAuth);
router.use('/products',    requireView('products'));
router.use('/collections', requireView('collections'));
// Inventory Watch (harvest2-lane6a) is its own view, so it is answered HERE,
// before the /reports prefix demands 'sales'.
router.get('/reports/inventory', requireView('inventory'), adminInventory.getInventoryReport);
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
// "Read with AI" (PRODUCT_IMPORT_AI_ENABLED, off by default; ice #306/#314 —
// controllers/adminProductImportAiController). /ai-config is always 200.
// /ai-extract is the PAID call: CSRF, then the flag (404), then today's page
// budget (429), and only THEN multer, so a dark or spent endpoint never
// buffers an upload. (Uses the same inline multer wrapper as parse-file; move
// both to lane 1a's uploadSingle when it lands.)
router.get('/products/import/ai-config', productImportAi.productImportAiConfig);
router.post('/products/import/ai-extract', csrfProtect, productImportAi.requireProductImportAi,
  productImportAi.requireAiPageBudget, productImportUpload, productImportAi.productImportAiExtract);
router.post('/products/import/preview', ...importBody, adminShop.previewProductImport);
router.post('/products/import/apply',   csrfProtect, ...importBody, adminShop.applyProductImport);
router.post('/products/bulk',           csrfProtect, adminShop.bulkUpdateProducts);
// Products → Duplicates and the merge (migration 120, ported from
// icelandicstore #309/#311/#312/#315; controllers/adminProductMergeController).
// Literal paths, so before /products/:id. The preview writes nothing but is a
// POST with a body, so it carries CSRF like the merge.
router.get('/products/duplicates',      productMerge.getProductDuplicates);
router.post('/products/merge/preview',  csrfProtect, productMerge.previewProductMerge);
router.post('/products/merge',          csrfProtect, productMerge.mergeProducts);
// A merged product is frozen: every WRITE through its own id (the product, its
// images, variants and collections) answers 409 product_merged + movedTo.
router.use('/products/:id', (req, res, next) =>
  (req.method === 'GET' || req.method === 'HEAD' ? next() : productMerge.refuseMergedProduct(req, res, next)));
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

// ── Product variants ────────────────────────────────────────────────────────
router.get('/products/:id/variants',                      adminShop.listVariants);
router.post('/products/:id/variants',           csrfProtect, adminShop.createVariant);
router.patch('/products/:id/variants/:variantId',  csrfProtect, adminShop.updateVariant);
router.delete('/products/:id/variants/:variantId', csrfProtect, adminShop.deactivateVariant);

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
