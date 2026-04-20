const express          = require('express');
const router           = express.Router();
const adminController  = require('../controllers/adminController');
const { requireAuth }  = require('../auth/middleware');
const { requireRole }  = require('../auth/roles');
const { csrfProtect }  = require('../middleware/csrf');

// All admin routes require authentication; most require admin role, but the
// read-only email-health endpoint is also surfaced to moderators so they can
// see whether notifications are flowing when they view the Party Admin page.
router.use(requireAuth);

router.get('/users',                    requireRole('admin'),              adminController.listUsers);
router.patch('/users/:id/role',         requireRole('admin'), csrfProtect, adminController.changeRole);
router.patch('/users/:id/disable',      requireRole('admin'), csrfProtect, adminController.disableUser);
router.patch('/users/:id/party-access', requireRole('admin'), csrfProtect, adminController.setPartyAccess);
router.delete('/users/:id',             requireRole('admin'), csrfProtect, adminController.deleteUser);

router.get('/email-health',             requireRole('admin', 'moderator'), adminController.getEmailHealth);

module.exports = router;
