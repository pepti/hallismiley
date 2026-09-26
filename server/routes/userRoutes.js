const express        = require('express');
const { verifyImageBytes } = require('../middleware/verifyImageBytes');
const router         = express.Router();
const userController = require('../controllers/userController');
const { requireAuth } = require('../auth/middleware');
const { csrfProtect } = require('../middleware/csrf');
const { validateProfileUpdate, validatePasswordChange } = require('../middleware/validate');
const { uploadSingle, createUserAvatarUpload } = require('../middleware/upload');

// User avatar upload (images only, max 5 MB) — customer-facing, so each
// rejection carries its own translated message (icelandicstore #142, harvest 2;
// the multer config moved to middleware/upload.js createUserAvatarUpload).
const avatarUploadMw = uploadSingle(createUserAvatarUpload, {
  LIMIT_FILE_SIZE: 'errors.upload.avatar.tooLarge',
  INVALID_TYPE:    'errors.upload.avatar.invalidType',
});

// All user routes require authentication
router.use(requireAuth);

router.get('/me',                         userController.getMe);
router.patch('/me',          csrfProtect, validateProfileUpdate, userController.updateMe);
router.post('/me/avatar',    csrfProtect, avatarUploadMw, verifyImageBytes, userController.uploadAvatar);
router.patch('/me/password', csrfProtect, validatePasswordChange, userController.changePassword);
// Per-account admin layout + the cookie choice (migration 111, harvested from
// icelandicstore): each writes only the caller's own row.
router.put('/me/page-width',        csrfProtect, userController.setPageWidth);
router.put('/me/page-width-motion', csrfProtect, userController.setPageWidthMotion);
router.put('/me/aside-width',       csrfProtect, userController.setAsideWidth);
router.put('/me/cookie-consent',    csrfProtect, userController.setCookieConsent);
router.get('/me/sessions',                userController.getSessions);
router.delete('/me/sessions',             csrfProtect, userController.revokeAllSessions);
router.delete('/me/sessions/:sessionId',  csrfProtect, userController.revokeSession);

module.exports = router;
