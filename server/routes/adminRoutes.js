const express          = require('express');
const router           = express.Router();
const adminController  = require('../controllers/adminController');
const { requireAuth }  = require('../auth/middleware');
const { requireRole }  = require('../auth/roles');
const { csrfProtect }  = require('../middleware/csrf');

// All admin routes require authentication + admin role
router.use(requireAuth, requireRole('admin'));

router.get('/users',                          adminController.listUsers);
router.patch('/users/:id/role',    csrfProtect, adminController.changeRole);
router.patch('/users/:id/disable', csrfProtect, adminController.disableUser);
router.delete('/users/:id',        csrfProtect, adminController.deleteUser);

module.exports = router;
