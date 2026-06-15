// Admin inbox for the change-request tool. Auth + admin role required (not
// test-env gated, so the queue is readable from any environment that has rows).
const express = require('express');
const router  = express.Router();

const ctrl = require('../controllers/changeRequestController');
const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');

router.use(requireAuth, requireRole('admin'));

router.get('/', ctrl.listBatches);
router.patch('/items/:itemId/status', csrfProtect, ctrl.updateItemStatus);

module.exports = router;
