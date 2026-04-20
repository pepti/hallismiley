const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const adminShop                = require('../controllers/adminShopController');
const { requireAuth }          = require('../auth/middleware');
const { requireRole }          = require('../auth/roles');
const { csrfProtect }          = require('../middleware/csrf');
const { createProductUpload }  = require('../middleware/upload');

// All admin shop routes require authentication + admin role
router.use(requireAuth, requireRole('admin'));

// ── Products ────────────────────────────────────────────────────────────────
router.get('/products',           adminShop.listProducts);
router.get('/products/:id',       adminShop.getProduct);
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
  adminShop.uploadImage);

router.delete('/products/:id/images/:imageId',
  csrfProtect, adminShop.deleteImage);

// ── Product variants ────────────────────────────────────────────────────────
router.get('/products/:id/variants',                      adminShop.listVariants);
router.post('/products/:id/variants',           csrfProtect, adminShop.createVariant);
router.patch('/products/:id/variants/:variantId',  csrfProtect, adminShop.updateVariant);
router.delete('/products/:id/variants/:variantId', csrfProtect, adminShop.deactivateVariant);

// ── Orders ──────────────────────────────────────────────────────────────────
router.get('/orders',             adminShop.listOrders);
router.get('/orders/:id',         adminShop.getOrder);
router.patch('/orders/:id/status', csrfProtect, adminShop.updateOrderStatus);

module.exports = router;
