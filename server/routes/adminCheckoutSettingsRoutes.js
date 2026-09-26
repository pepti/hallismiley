// Admin → Afgreiðsla (checkout settings; harvest2-lane7a, ported from
// icelandicstore #151). Gated like every settings screen: requireAuth + the
// screen's own view id ('checkout', owned by the shop module — a switched-off
// shop 404s this mount before auth, config/modules.js), CSRF + sanitizeBody on
// the write; app.js puts the write under writeLimiter.
const express = require('express');
const router  = express.Router();

const ctrl             = require('../controllers/adminCheckoutSettingsController');
const { requireAuth }  = require('../auth/middleware');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');

router.use(requireAuth, requireView('checkout'));

// Mounted at /api/v1/admin/checkout-settings.
router.get('/', ctrl.get);
router.patch('/', csrfProtect, sanitizeBody, ctrl.update);

module.exports = router;
