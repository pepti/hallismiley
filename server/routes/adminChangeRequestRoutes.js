// Admin inbox for the change-request tool. Auth + admin role required (not
// test-env gated, so the queue is readable from any environment that has rows).
const express = require('express');
const router  = express.Router();

const ctrl = require('../controllers/changeRequestController');
const { requireAuth } = require('../auth/middleware');
const { requireView } = require('../auth/requireView');
const { csrfProtect } = require('../middleware/csrf');
const { requireRole } = require('../auth/roles');

router.use(requireAuth, requireView('feedback'));

router.get('/', ctrl.listBatches);
// The widget's PROD on/off switch (Admin → Feedback). Admin only, on top of the
// view gate above: requireView('feedback') admits moderators to the inbox, but
// opening a submit surface on production is not a moderator's call.
router.get('/settings', requireRole('admin'), ctrl.getSettings);
router.patch('/settings', requireRole('admin'), csrfProtect, ctrl.updateSettings);
router.patch('/items/:itemId/status', csrfProtect, ctrl.updateItemStatus);

module.exports = router;
