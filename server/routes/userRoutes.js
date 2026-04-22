const express        = require('express');
const multer         = require('multer');
const fs             = require('fs');
const router         = express.Router();
const userController = require('../controllers/userController');
const { requireAuth } = require('../auth/middleware');
const { csrfProtect } = require('../middleware/csrf');
const { validateProfileUpdate, validatePasswordChange } = require('../middleware/validate');
const { userAvatarDir } = require('../config/paths');

// ── User avatar upload (images only, max 5 MB) ────────────────────────────────
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const avatarStorage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = userAvatarDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    // Filename is fully derived from the verified mimetype + a random suffix —
    // no part of the user-supplied originalname is used, so traversal is impossible.
    const ext  = MIME_EXT[file.mimetype] || '.jpg';
    const rand = Math.random().toString(36).slice(2, 9);
    const name = `user-${req.user.id}-${Date.now()}-${rand}${ext}`;
    cb(null, name);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter(req, file, cb) {
    if (ALLOWED_AVATAR_MIME.includes(file.mimetype)) return cb(null, true);
    const err = new Error('Avatar must be a JPG, PNG, or WebP image');
    err.code = 'INVALID_TYPE';
    cb(err);
  },
  limits: { fileSize: MAX_AVATAR_SIZE },
});

function avatarUploadMw(req, res, next) {
  avatarUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Avatar must not exceed 5 MB'
        : `Upload error: ${err.message}`;
      return res.status(400).json({ error: msg, code: 400 });
    }
    if (err) return res.status(400).json({ error: err.message, code: 400 });
    next();
  });
}

// All user routes require authentication
router.use(requireAuth);

router.get('/me',                         userController.getMe);
router.patch('/me',          csrfProtect, validateProfileUpdate, userController.updateMe);
router.post('/me/avatar',    csrfProtect, avatarUploadMw, userController.uploadAvatar);
router.patch('/me/password', csrfProtect, validatePasswordChange, userController.changePassword);
router.get('/me/sessions',                userController.getSessions);
router.delete('/me/sessions',             csrfProtect, userController.revokeAllSessions);
router.delete('/me/sessions/:sessionId',  csrfProtect, userController.revokeSession);

module.exports = router;
