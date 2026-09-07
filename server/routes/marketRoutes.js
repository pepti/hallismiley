const express = require('express');
const router  = express.Router();

const marketController = require('../controllers/marketController');
const { validateMarketStatus } = require('../middleware/validate');
const { requireAuth }  = require('../auth/middleware');
const { requireRole }  = require('../auth/roles');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');

// Markaður — the prospect list (migration 093, ENHANCEMENTS #16).
//
// Access model:
//   READ                          → requireView('markadur')
//   PATCH /:id/status (hand-off)  → requireRole('admin', 'moderator')
// Nothing here is public: every route sits behind requireAuth, and the
// controller marks every response `Cache-Control: no-store`. The tables are
// written only by server/scripts/market-import.js; the status write above is
// the app's single exception.

router.get('/',
  requireAuth, requireView('markadur'),
  marketController.list);

router.get('/:id',
  requireAuth, requireView('markadur'),
  marketController.getOne);

router.patch('/:id/status',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateMarketStatus,
  marketController.setStatus);

module.exports = router;
