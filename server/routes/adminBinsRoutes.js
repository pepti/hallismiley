// BIN System API — the visual warehouse-stock board (admin view 'bins').
// Auth + per-view RBAC: a role granted the 'bins' view (or admin) gets access.
// Reads are open to the view; the single write (move) is CSRF-protected.
const express = require('express');
const router  = express.Router();

const ctrl             = require('../controllers/adminBinsController');
const { requireAuth }  = require('../auth/middleware');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');

router.use(requireAuth, requireView('bins'));

// Mounted at /api/v1/admin/bins. Literal paths are registered before the
// `/:bin/items` param route so they can't be swallowed by it.
router.get('/board',      ctrl.board);       // zone chips + headline summary
router.get('/queue',      ctrl.queue);       // active items with no bin
router.get('/mismatches', ctrl.mismatches);  // items with a malformed bin code
router.get('/lookup',     ctrl.lookup);      // exact scan resolve (?code=)
router.get('/search',     ctrl.search);      // fuzzy search (?q=)
router.get('/zone/:zone', ctrl.zone);        // the grid for one zone
router.get('/:bin/items', ctrl.items);       // products stored in one bin

router.patch('/move', csrfProtect, sanitizeBody, ctrl.move); // relocate an item

module.exports = router;
