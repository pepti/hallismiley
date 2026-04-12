const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const partyController              = require('../controllers/partyController');
const { _checkInviteAccess }       = require('../controllers/partyController');
const { requireAuth }              = require('../auth/middleware');
const { requireRole }              = require('../auth/roles');
const { csrfProtect }              = require('../middleware/csrf');

// ── Party photo upload (images only, max 10 MB) ────────────────────────────────
const PARTY_PHOTO_DIR = path.join(__dirname, '../../public/assets/party');

const partyPhotoStorage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(PARTY_PHOTO_DIR, { recursive: true });
    cb(null, PARTY_PHOTO_DIR);
  },
  filename(req, file, cb) {
    const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, name);
  },
});

const partyPhotoUpload = multer({
  storage: partyPhotoStorage,
  fileFilter(req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    const err = new Error('Only images (jpg, png, webp) are allowed');
    err.code = 'INVALID_TYPE';
    cb(err);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── requirePartyAccess — invited users only ────────────────────────────────────
async function requirePartyAccess(req, res, next) {
  try {
    if (!req.user.email_verified) {
      return res.status(403).json({
        error: 'Please verify your email to access the party page.',
        code: 403,
        reason: 'email_not_verified',
      });
    }
    const hasAccess = await _checkInviteAccess(req.user.email);
    if (!hasAccess) {
      return res.status(403).json({ error: 'You are not on the guest list', code: 403 });
    }
    next();
  } catch (err) { next(err); }
}

// ── Admin: invite management ──────────────────────────────────────────────────
router.post('/invites',
  requireAuth, requireRole('admin'), csrfProtect,
  partyController.addInvites);

router.get('/invites',
  requireAuth, requireRole('admin'),
  partyController.listInvites);

router.delete('/invites/:id',
  requireAuth, requireRole('admin'), csrfProtect,
  partyController.deleteInvite);

// ── Access check (any authenticated user) ─────────────────────────────────────
router.get('/access',
  requireAuth,
  partyController.checkAccess);

// ── Party info ────────────────────────────────────────────────────────────────
router.get('/info',
  requireAuth, requirePartyAccess,
  partyController.getInfo);

router.patch('/info',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  partyController.updateInfo);

// ── RSVP ─────────────────────────────────────────────────────────────────────
router.post('/rsvp',
  requireAuth, requirePartyAccess, csrfProtect,
  partyController.upsertRsvp);

router.get('/rsvp',
  requireAuth, requirePartyAccess,
  partyController.getMyRsvp);

router.get('/rsvps',
  requireAuth, requireRole('admin'),
  partyController.getAllRsvps);

// ── Guestbook ─────────────────────────────────────────────────────────────────
router.post('/guestbook',
  requireAuth, requirePartyAccess, csrfProtect,
  partyController.postGuestbook);

router.get('/guestbook',
  requireAuth, requirePartyAccess,
  partyController.getGuestbook);

router.delete('/guestbook/:id',
  requireAuth, requirePartyAccess, csrfProtect,
  partyController.deleteGuestbookEntry);

// ── Photos ────────────────────────────────────────────────────────────────────
router.post('/photos',
  requireAuth, requirePartyAccess, csrfProtect,
  (req, res, next) => {
    partyPhotoUpload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}`, code: 400 });
      }
      if (err) {
        return res.status(400).json({ error: err.message, code: 400 });
      }
      next();
    });
  },
  partyController.uploadPhoto);

router.get('/photos',
  requireAuth, requirePartyAccess,
  partyController.getPhotos);

router.delete('/photos/:id',
  requireAuth, requirePartyAccess, csrfProtect,
  partyController.deletePhoto);

module.exports = router;
