const express = require('express');
const router  = express.Router();

const leadsController = require('../controllers/leadsController');
const { validateLeadUpdate } = require('../middleware/validate');
const { requireAuth }  = require('../auth/middleware');
const { requireRole }  = require('../auth/roles');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');

// Leads inbox — the /hafa-samband enquiries (migration 097).
//
// Access model:
//   READ                        → requireView('leads')  — the `solufolk` role
//   PATCH status / note / owner → requireView('leads')  — the seller's own work
//                                  product; the submission fields are immutable
//                                  (validateLeadUpdate whitelists the body)
//   DELETE (erasure)            → requireRole('admin')
//   CSV export (bulk PII)       → requireRole('admin')
// Nothing here is public: every route sits behind requireAuth, and the
// controller marks every response `Cache-Control: no-store`.
//
// NOTE: /export.csv must be registered before /:id so Express does not treat
// the literal as an id.

router.get('/export.csv',
  requireAuth, requireRole('admin'),
  leadsController.exportCsv);

router.get('/',
  requireAuth, requireView('leads'),
  leadsController.list);

router.get('/:id',
  requireAuth, requireView('leads'),
  leadsController.getOne);

router.patch('/:id',
  requireAuth, requireView('leads'), csrfProtect, sanitizeBody, validateLeadUpdate,
  leadsController.update);

router.delete('/:id',
  requireAuth, requireRole('admin'), csrfProtect,
  leadsController.remove);

module.exports = router;
