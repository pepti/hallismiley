'use strict';
// Admin routes for the home-hero background config + the background media
// library. All admin-only; mutations CSRF-protected. Mounted at
// /api/v1/admin/background (BEFORE the /api/v1/admin catch-all).
const express = require('express');
const router  = express.Router();

const { requireAuth } = require('../auth/middleware');
const { requireView } = require('../auth/requireView');
const { csrfProtect } = require('../middleware/csrf');
const { uploadSingle, createBackgroundUpload } = require('../middleware/upload');
const { verifyImageBytes } = require('../middleware/verifyImageBytes');
const ctrl = require('../controllers/adminBackgroundController');
const { recordUpload } = require('../services/uploadVolumeAlert');

router.use(requireAuth, requireView('background'));

// Landing-page background config
router.get('/landing',   ctrl.getLanding);
router.patch('/landing', csrfProtect, ctrl.updateLanding);

// Library enable toggle
router.get('/library',   ctrl.getLibrary);
router.patch('/library', csrfProtect, ctrl.updateLibrary);

// Library sections — /reorder is declared before /:id so the literal wins.
router.get('/sections',           ctrl.listSections);
router.post('/sections',          csrfProtect, ctrl.createSection);
router.patch('/sections/reorder', csrfProtect, ctrl.reorderSections);
router.patch('/sections/:id',     csrfProtect, ctrl.updateSection);
router.delete('/sections/:id',    csrfProtect, ctrl.deleteSection);

// Media library
router.get('/media', ctrl.listMedia);
router.post('/media',
  csrfProtect,
  uploadSingle(createBackgroundUpload, {
    LIMIT_FILE_SIZE: 'errors.upload.background.tooLarge',
    INVALID_TYPE:    'errors.upload.background.invalidType',
  }),
  verifyImageBytes,
  // Count the accepted file and, on a large burst, raise a warn row for
  // Admin → Monitoring. This NEVER blocks: the request is already past multer,
  // and recordUpload swallows its own failures. Uploads are carved out of the
  // global limiter (BG_MEDIA_UPLOAD_PATH in app.js) precisely so a big batch
  // always finishes — we notify that it was large, we never refuse it.
  (req, _res, next) => {
    if (req.file) {
      recordUpload({
        userId:    req.user?.id || null,
        username:  req.user?.username || null,
        path:      `${req.method} ${req.originalUrl}`,
        requestId: req.requestId || null,
      });
    }
    next();
  },
  ctrl.uploadMedia);
router.patch('/media/reorder', csrfProtect, ctrl.reorderMedia);
router.patch('/media/:id',     csrfProtect, ctrl.updateMedia);
router.delete('/media/:id',    csrfProtect, ctrl.deleteMedia);

module.exports = router;
