const express        = require('express');
const router         = express.Router();
const userController = require('../controllers/userController');
const { requireAuth } = require('../auth/middleware');
const { csrfProtect } = require('../middleware/csrf');
const { validateProfileUpdate, validatePasswordChange } = require('../middleware/validate');

// ── Public routes (no auth) ──────────────────────────────────────────────────
// Must be defined before requireAuth to avoid auth requirement on public profile.
// Note: /me routes below won't conflict because ':username' won't match 'me'
// when the public profile route is registered on /api/v1/users (not /me).
router.get('/:username/profile', userController.getPublicProfile);

// ── All routes below require authentication ──────────────────────────────────
router.use(requireAuth);

router.get('/me',                         userController.getMe);
router.patch('/me',          csrfProtect, validateProfileUpdate, userController.updateMe);
router.patch('/me/password', csrfProtect, validatePasswordChange, userController.changePassword);
router.get('/me/sessions',                userController.getSessions);
router.delete('/me/sessions',             csrfProtect, userController.revokeAllSessions);
router.delete('/me/sessions/:sessionId',  csrfProtect, userController.revokeSession);

// Favorites
router.get('/me/favorites',                          userController.getFavorites);
router.post('/me/favorites/:projectId',   csrfProtect, userController.addFavorite);
router.delete('/me/favorites/:projectId', csrfProtect, userController.removeFavorite);

module.exports = router;
