const express          = require('express');
const router           = express.Router();
const adminController  = require('../controllers/adminController');
const { requireAuth }  = require('../auth/middleware');
const { requireRole }  = require('../auth/roles');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');

// All admin routes require authentication; most require admin role, but the
// read-only email-health endpoint is also surfaced to moderators so they can
// see whether notifications are flowing when they view the Party Admin page.
router.use(requireAuth);

router.get('/users',                    requireView('users'),              adminController.listUsers);
router.patch('/users/:id/role',         requireRole('admin'), csrfProtect, adminController.changeRole);
// Replaces a mailbox-less login's password (a name-only customer, ice #382/#397)
// — the only way back when the one shown at create time is lost. Answers once.
router.post('/users/:id/new-password',  requireRole('admin'), csrfProtect, adminController.newPassword);
// Clears another user's two-step verification — the way back in for someone who
// lost their phone AND their recovery codes (ice #396). Never your own: that goes
// through /auth/totp/disable, which asks for the password again.
router.post('/users/:id/totp/reset',   requireRole('admin'), csrfProtect, adminController.resetTotp);
router.patch('/users/:id/disable',      requireRole('admin'), csrfProtect, adminController.disableUser);
// Time-limited login (migration 114): { expires_at } — ISO, YYYY-MM-DD or null.
router.patch('/users/:id/expiry',       requireRole('admin'), csrfProtect, adminController.setExpiry);
router.patch('/users/:id/party-access', requireRole('admin'), csrfProtect, adminController.setPartyAccess);
router.patch('/users/:id/approve',      requireRole('admin'), csrfProtect, adminController.approveUser);
router.patch('/users/:id/decline',      requireRole('admin'), csrfProtect, adminController.declineUser);
router.delete('/users/:id',             requireRole('admin'), csrfProtect, adminController.deleteUser);

router.get('/email-health',             requireRole('admin', 'moderator'), adminController.getEmailHealth);

module.exports = router;
