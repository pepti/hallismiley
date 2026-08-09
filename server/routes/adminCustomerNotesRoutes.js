// Staff notes ABOUT customers. Gated by the grantable 'customers' view (HalliProjects'
// view-based RBAC): admins see/author everything; any other role holding the view
// only sees/authors 'staff'-visibility notes (controller + model enforce that).
// Mounted at /api/v1/admin/customer-notes; writes get CSRF + HTML sanitize like
// the other admin write routes.
const express = require('express');
const router  = express.Router();

const ctrl             = require('../controllers/adminCustomerNoteController');
const { requireAuth }  = require('../auth/middleware');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');

router.use(requireAuth, requireView('customers'));

router.get('/',       ctrl.list);
router.post('/',      csrfProtect, sanitizeBody, ctrl.create);
router.patch('/:id',  csrfProtect, sanitizeBody, ctrl.update);
router.delete('/:id', csrfProtect, ctrl.remove);

module.exports = router;
