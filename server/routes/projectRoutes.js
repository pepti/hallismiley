const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const projectController                          = require('../controllers/projectController');
const { validateProject, validateQuery,
        validateMediaUpdate, validateReorder,
        validateSection, validateSectionReorder } = require('../middleware/validate');
const { requireAuth }                            = require('../auth/middleware');
const { requireRole }                            = require('../auth/roles');
const { csrfProtect }                            = require('../middleware/csrf');
const { createProjectUpload }                    = require('../middleware/upload');

// ── Public read endpoints (A03: query params validated) ───────────────────────
router.get('/',             validateQuery, projectController.getAll);
router.get('/featured',     projectController.getFeatured);
router.get('/:id/media',    projectController.getMedia);
router.get('/:id/sections', projectController.getSections);
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

// ── Delete (admin only) ────────────────────────────────────────────────────────
router.delete('/:id',
  requireAuth, requireRole('admin'), csrfProtect,
  projectController.remove);

router.delete('/:id/media/:mediaId',
  requireAuth, requireRole('admin'), csrfProtect,
  projectController.deleteMedia);

router.delete('/:id/sections/:sectionId',
  requireAuth, requireRole('admin'), csrfProtect,
  projectController.deleteSection);

module.exports = router;
