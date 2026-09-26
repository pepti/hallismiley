// Inventory Watch "Fix stock" + the stock count (admin view 'inventory';
// harvest2-lane6a-2026-09-26, ported from icelandicstore #13/#15/#18).
// Mounted at /api/v1/admin/inventory. The watch REPORT itself is
// GET /api/v1/admin/shop/reports/inventory (adminShopRoutes.js), behind the
// same view. Writes are CSRF-protected and go through models/Inventory.js.
const express = require('express');
const router  = express.Router();

const ctrl             = require('../controllers/adminInventoryController');
const { requireAuth }  = require('../auth/middleware');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');

router.use(requireAuth, requireView('inventory'));

router.get('/lookup',  ctrl.lookup);                                   // scan resolve (?code=)
router.get('/search',  ctrl.search);                                   // picker search (?q=)
router.patch('/stock', csrfProtect, sanitizeBody, ctrl.correctStock);  // "Fix stock" — one unit
router.post('/count',  csrfProtect, sanitizeBody, ctrl.applyCount);    // stock count — one batch

module.exports = router;
