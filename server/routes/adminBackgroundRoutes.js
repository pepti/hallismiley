'use strict';
// Admin routes for the home-hero background config + the background media
// library. All admin-only; mutations CSRF-protected. Mounted at
// /api/v1/admin/background (BEFORE the /api/v1/admin catch-all).
const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const { requireAuth } = require('../auth/middleware');
const { requireView } = require('../auth/requireView');
const { csrfProtect } = require('../middleware/csrf');
const { createBackgroundUpload } = require('../middleware/upload');
const ctrl = require('../controllers/adminBackgroundController');

router.use(requireAuth, requireView('background'));

// Landing-page background config
router.get('/landing',   ctrl.getLanding);
router.patch('/landing', csrfProtect, ctrl.updateLanding);

// Media library
router.get('/media', ctrl.listMedia);
router.post('/media',
  csrfProtect,
  (req, res, next) => {
    createBackgroundUpload().single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}`, code: 400 });
      }
      if (err) return res.status(400).json({ error: err.message, code: 400 });
      next();
    });
  },
  ctrl.uploadMedia);
router.delete('/media/:id', csrfProtect, ctrl.deleteMedia);

module.exports = router;
