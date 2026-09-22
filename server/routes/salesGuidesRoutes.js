const express = require('express');
const router  = express.Router();

const salesGuidesController = require('../controllers/salesGuidesController');
const { validateGuide, validateGuideReorder } = require('../middleware/validate');
const { requireAuth }  = require('../auth/middleware');
const { requireRole }  = require('../auth/roles');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');

// Handbók sölufólks — internal sales-staff guides.
//
// Access model (mirrors the news/bookkeeping convention):
//   READ (published only)  → requireView('handbok')   — the `solufolk` role
//   EDIT / drafts / manage → requireRole('admin','moderator')
//   DELETE                 → requireRole('admin')      — moderators unpublish
// Nothing here is public: every route sits behind requireAuth, and the
// controller marks every response `Cache-Control: no-store`.
//
// NOTE: /manage and /reorder must be registered before /:slug and /:id so
// Express does not treat the literal words as parameters.

router.get('/manage',
  requireAuth, requireRole('admin', 'moderator'),
  salesGuidesController.manageList);

router.put('/reorder',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateGuideReorder,
  salesGuidesController.reorder);

router.get('/:slug/preview',
  requireAuth, requireRole('admin', 'moderator'),
  salesGuidesController.preview);

router.get('/',
  requireAuth, requireView('handbok'),
  salesGuidesController.list);

router.get('/:slug',
  requireAuth, requireView('handbok'),
  salesGuidesController.getOne);

router.post('/',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateGuide,
  salesGuidesController.create);

router.patch('/:id',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateGuide,
  salesGuidesController.update);

router.delete('/:id',
  requireAuth, requireRole('admin'), csrfProtect,
  salesGuidesController.remove);

module.exports = router;
