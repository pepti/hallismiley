const express   = require('express');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const fs        = require('fs');
const router    = express.Router();

const partyController              = require('../controllers/partyController');
const { _checkInviteAccess }       = require('../controllers/partyController');
const { requireAuth }              = require('../auth/middleware');
const { requireRole }              = require('../auth/roles');
const { csrfProtect }              = require('../middleware/csrf');
const { partyUploadDir }           = require('../config/paths');
const { MIME_TO_EXT }              = require('../middleware/upload');

const isTest = () => process.env.NODE_ENV === 'test';

// Redeem invite code: 5 attempts/hr/IP — deters brute-force code guessing.
const inviteRedeemLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  skip: isTest,
  message: { error: 'Too many attempts. Try again in an hour.', code: 429 },
});

// ── Party photo upload (images only, max 10 MB) ────────────────────────────────
const PARTY_PHOTO_DIR = partyUploadDir();

const partyPhotoStorage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(PARTY_PHOTO_DIR, { recursive: true });
    cb(null, PARTY_PHOTO_DIR);
  },
  filename(req, file, cb) {
    // Derive extension from the accepted MIME type (not originalname) to
    // prevent attackers from storing files with attacker-chosen extensions.
    const ext  = MIME_TO_EXT[file.mimetype] || '.jpg';
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
// Email verification is NOT required for party access — users can skip it
// via the "Continue anyway" link on the frontend.
async function requirePartyAccess(req, res, next) {
  try {
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

// ── Invite code — redeem (any authed user) / read (admin/moderator only) ─────
router.post('/redeem-invite-code',
  requireAuth, inviteRedeemLimiter, csrfProtect,
  partyController.redeemInviteCode);

router.get('/invite-code',
  requireAuth, requireRole('admin', 'moderator'),
  partyController.getInviteCode);

// ── Party info (public — no auth required) ───────────────────────────────────
router.get('/info',
  partyController.getInfo);

router.patch('/info',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  partyController.updateInfo);

// Hero cover image (admin/moderator only — see partyController.uploadCoverImage)
router.post('/cover-image',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
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
  partyController.uploadCoverImage);

// ── RSVP ─────────────────────────────────────────────────────────────────────
router.post('/rsvp',
  requireAuth, requirePartyAccess, csrfProtect,
  partyController.upsertRsvp);

router.get('/rsvp',
  requireAuth, requirePartyAccess,
  partyController.getMyRsvp);

router.get('/rsvps',
  requireAuth, requireRole('admin', 'moderator'),
  partyController.getAllRsvps);

router.get('/invited-guests',
  requireAuth, requireRole('admin', 'moderator'),
  partyController.listInvitedGuests);

// ── Logistics (admin/moderator) ───────────────────────────────────────────────
router.get('/logistics',
  requireAuth, requireRole('admin', 'moderator'),
  partyController.listLogistics);

router.post('/logistics',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  partyController.addLogisticsItem);

// Specific logistics actions MUST be declared before the /:id routes,
// otherwise Express matches them as PATCH/DELETE on an item with id="reorder".
router.post('/logistics/reorder',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  partyController.reorderLogistics);

router.post('/logistics/all-at-venue',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  partyController.markAllAtVenue);

router.patch('/logistics/:id',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  partyController.updateLogisticsItem);

router.delete('/logistics/:id',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  partyController.deleteLogisticsItem);

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
