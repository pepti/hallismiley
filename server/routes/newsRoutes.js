const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const newsController                               = require('../controllers/newsController');
const { validateNews, validateNewsMediaUpdate,
        validateNewsMediaReorder, validateQuery }   = require('../middleware/validate');
const { requireAuth }                              = require('../auth/middleware');
const { requireRole }                              = require('../auth/roles');
const { csrfProtect }                              = require('../middleware/csrf');
const { createNewsUpload, verifyFileBytes }        = require('../middleware/upload');

// ── Public read endpoints ─────────────────────────────────────────────────────
// NOTE: /admin/list must be registered before /:slug so Express does not treat
// the literal string "admin" as a slug parameter.
router.get('/admin/list',
  requireAuth, requireRole('admin', 'moderator'), validateQuery,
  newsController.adminList);

router.get('/:slug/preview',
  requireAuth, requireRole('admin', 'moderator'),
  newsController.preview);

router.get('/',    newsController.list);
router.get('/:slug', newsController.getOne);

// ── Create / update (admin + moderator) ──────────────────────────────────────
router.post('/',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateNews,
  newsController.create);

router.patch('/:id',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateNews,
  newsController.update);

// ── Delete (admin + moderator) ───────────────────────────────────────────────
router.delete('/:id',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  newsController.remove);

// ── Media management (admin + moderator) ──────────────────────────────────────
// Public read
router.get('/:id/media', newsController.getMedia);

// Reorder must come before /:id/media/:mediaId
router.put('/:id/media/reorder',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateNewsMediaReorder,
  newsController.reorderMedia);

// YouTube embed (JSON body, no file upload)
router.post('/:id/media/youtube',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  newsController.addYouTube);

// File upload — multer processes the multipart body
router.post('/:id/media',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  (req, res, next) => {
    const upload = createNewsUpload(req.params.id);
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}`, code: 400 });
      }
      if (err) {
        return res.status(400).json({ error: err.message, code: 400 });
      }
      next();
    });
  },
  verifyFileBytes,
  newsController.addMedia);

router.patch('/:id/media/:mediaId',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateNewsMediaUpdate,
  newsController.updateMedia);

router.delete('/:id/media/:mediaId',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  newsController.deleteMedia);

module.exports = router;
