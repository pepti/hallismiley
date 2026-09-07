const express = require('express');
const router  = express.Router();

const ctrl = require('../controllers/accountsController');
const { validateAccountCreate, validateAccountPatch } = require('../middleware/validate');
const { requireAuth }  = require('../auth/middleware');
const { requireRole }  = require('../auth/roles');
const { requireView }  = require('../auth/requireView');
const { accountScope } = require('../auth/accountScope');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');

// Customer accounts (migration 098, ENHANCEMENTS #17).
//
// Access model:
//   list / read / create / patch / provision-request / audit / commission
//     → requireView('accounts') + accountScope — a seller works ONLY their own
//       accounts (the model enforces the scope; foreign ids answer 404);
//       admin and the `allaccounts` permission see every account.
//   PATCH /:id/owner → requireRole('admin') — commission follows the owner.
// Nothing here is public; every response is Cache-Control: no-store.

router.use(requireAuth);

router.get('/',                requireView('accounts'), accountScope, ctrl.list);
router.post('/',               requireView('accounts'), accountScope, csrfProtect, sanitizeBody, validateAccountCreate, ctrl.create);
router.get('/:id',             requireView('accounts'), accountScope, ctrl.getOne);
router.patch('/:id',           requireView('accounts'), accountScope, csrfProtect, sanitizeBody, validateAccountPatch, ctrl.update);
router.patch('/:id/owner',     requireRole('admin'),    csrfProtect, sanitizeBody, ctrl.changeOwner);
router.post('/:id/provision-request', requireView('accounts'), accountScope, csrfProtect, ctrl.requestProvision);
router.get('/:id/audit',       requireView('accounts'), accountScope, ctrl.audit);
// Commission figures are gated on the commission view as well as the account:
// `allaccounts` widens which ACCOUNTS you see, never which earnings. Without
// this second gate a `verktaki` (accounts + allaccounts, no commission by
// design) could read every seller's rates and amounts through this route.
router.get('/:id/commission',  requireView('accounts'), requireView('commission'), accountScope, ctrl.commission);

module.exports = router;
