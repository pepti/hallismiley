const express        = require('express');
const router         = express.Router();
const userController = require('../controllers/userController');
const { requireAuth } = require('../auth/middleware');
const { csrfProtect } = require('../middleware/csrf');
const { validateProfileUpdate, validatePasswordChange } = require('../middleware/validate');

// All user routes require authentication
router.use(requireAuth);

router.get('/me',                         userController.getMe);
router.patch('/me',          csrfProtect, validateProfileUpdate, userController.updateMe);
router.patch('/me/password', csrfProtect, validatePasswordChange, userController.changePassword);
router.get('/me/sessions',                userController.getSessions);
router.delete('/me/sessions',             csrfProtect, userController.revokeAllSessions);
router.delete('/me/sessions/:sessionId',  csrfProtect, userController.revokeSession);

module.exports = router;
