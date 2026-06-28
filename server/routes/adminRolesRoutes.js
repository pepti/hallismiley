// Admin roles management. HARD admin-only (requireRole('admin')) — managing the
// role↔view mapping is a meta-permission and must NEVER be reachable via a
// granted view (privilege-escalation prevention).
const express = require('express');
const router  = express.Router();

const ctrl             = require('../controllers/adminRolesController');
const { requireAuth }  = require('../auth/middleware');
const { requireRole }  = require('../auth/roles');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');

router.use(requireAuth, requireRole('admin'));

// Mounted at /api/v1/admin/roles.
router.get('/',         ctrl.list);
// Membership / "Members" board. /members must precede the /:name routes so it is
// never captured as a role name.
router.get('/members',                  ctrl.listMembers);
router.post('/:name/members',           csrfProtect, sanitizeBody, ctrl.addMember);
router.delete('/:name/members/:userId', csrfProtect, ctrl.removeMember);
router.post('/',        csrfProtect, sanitizeBody, ctrl.create);
router.patch('/:name',  csrfProtect, sanitizeBody, ctrl.update);
router.delete('/:name', csrfProtect, ctrl.remove);

module.exports = router;
