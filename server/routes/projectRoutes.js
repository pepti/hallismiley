const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const projectController                          = require('../controllers/projectController');
const { validateProject, validateQuery,
        validateMediaUpdate, validateReorder,
        validateSection, validateSectionReorder,
        validateVideoUpdate, validateVideoReorder } = require('../middleware/validate');
const { requireAuth }                            = require('../auth/middleware');
const { requireRole }                            = require('../auth/roles');
const { csrfProtect }                            = require('../middleware/csrf');
const { createProjectUpload }                    = require('../middleware/upload');

// ── Public read endpoints (A03: query params validated) ───────────────────────
router.get('/',             validateQuery, projectController.getAll);
router.get('/featured',     projectController.getFeatured);
router.get('/:id/media',    projectController.getMedia);
router.get('/:id/sections', projectController.getSections);
router.get('/:id/videos',   projectController.getVideos);
router.get('/:id',          projectController.getOne);

// ── Project create / update (admin + moderator) ────────────────────────────────
router.post('/',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateProject,
  projectController.create);

router.put('/:id',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateProject,
  projectController.update);

router.patch('/:id',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateProject,
  projectController.update);

// ── Media management (admin + moderator) ──────────────────────────────────────
// NOTE: /:id/media/reorder must be before /:id/media/:mediaId so Express
// does not treat the literal string "reorder" as a numeric mediaId param.
router.patch('/:id/media/reorder',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateReorder,
  projectController.reorderMedia);

router.patch('/:id/cover',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  projectController.setCover);

// File upload — multer processes the multipart body; CSRF is still enforced via
// the X-CSRF-Token *header* which is available before the body is parsed.
router.post('/:id/media',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  (req, res, next) => {
    const upload = createProjectUpload(req.params.id);
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
  projectController.addMedia);

router.patch('/:id/media/:mediaId',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateMediaUpdate,
  projectController.updateMedia);

// ── Section management (admin + moderator) ────────────────────────────────────
// /:id/sections/reorder must be declared BEFORE /:id/sections/:sectionId so
// Express does not treat the literal string "reorder" as the sectionId param.
router.patch('/:id/sections/reorder',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateSectionReorder,
  projectController.reorderSections);

router.post('/:id/sections',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateSection,
  projectController.createSection);

router.patch('/:id/sections/:sectionId',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateSection,
  projectController.updateSection);

// ── Video section management (admin + moderator) ─────────────────────────────
// Order-sensitive: /:id/videos/reorder and /:id/videos/position must come
// BEFORE /:id/videos/:videoId so Express doesn't treat those literal strings
// as numeric IDs.
router.patch('/:id/videos/reorder',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateVideoReorder,
  projectController.reorderVideos);

router.patch('/:id/videos/position',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  projectController.setVideoSectionPosition);

// File upload OR JSON body ({ url, title? }) for a YouTube embed.
router.post('/:id/videos',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    // JSON body (YouTube URL) — skip multer entirely
    if (!contentType.startsWith('multipart/')) return next();
    // Otherwise run multer on the single 'file' field
    const upload = createProjectUpload(req.params.id);
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}`, code: 400 });
      }
      if (err) return res.status(400).json({ error: err.message, code: 400 });
      next();
    });
  },
  projectController.addVideo);

router.patch('/:id/videos/:videoId',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateVideoUpdate,
  projectController.updateVideo);

// ── Delete (admin + moderator) ─────────────────────────────────────────────────
router.delete('/:id',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  projectController.remove);

router.delete('/:id/media/:mediaId',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  projectController.deleteMedia);

router.delete('/:id/sections/:sectionId',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  projectController.deleteSection);

// Clear-all must come BEFORE /:id/videos/:videoId so "videos" isn't treated as an id
router.delete('/:id/videos',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  projectController.deleteVideoSection);

router.delete('/:id/videos/:videoId',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  projectController.deleteVideo);

module.exports = router;
