// Admin discount management. Auth + admin role required for all routes.
const express = require('express');
const router  = express.Router();

const ctrl             = require('../controllers/adminDiscountController');
const { requireAuth }  = require('../auth/middleware');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');

router.use(requireAuth, requireView('discounts'));

// Mounted at /api/v1/admin/discounts.
router.get('/',        ctrl.list);
router.post('/',       csrfProtect, sanitizeBody, ctrl.create);
router.patch('/:id',   csrfProtect, sanitizeBody, ctrl.update);

module.exports = router;
