// Admin "General" settings. Auth + admin role required for read and write.
const express = require('express');
const router  = express.Router();

const ctrl             = require('../controllers/adminGeneralSettingsController');
const { requireAuth }  = require('../auth/middleware');
const { requireRole }  = require('../auth/roles');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');

router.use(requireAuth, requireRole('admin'));

// Mounted at /api/v1/admin/general-settings.
router.get('/', ctrl.get);
router.patch('/', csrfProtect, sanitizeBody, ctrl.update);

module.exports = router;
