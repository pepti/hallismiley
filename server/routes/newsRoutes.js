const express    = require('express');
const router     = express.Router();

const newsController            = require('../controllers/newsController');
const { validateNews }          = require('../middleware/validate');
const { requireAuth }           = require('../auth/middleware');
const { requireRole }           = require('../auth/roles');
const { csrfProtect }           = require('../middleware/csrf');

// ── Public read endpoints ─────────────────────────────────────────────────────
// NOTE: /admin/list must be registered before /:slug so Express does not treat
// the literal string "admin" as a slug parameter.
router.get('/admin/list',
  requireAuth, requireRole('admin', 'moderator'),
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

// ── Delete (admin only) ───────────────────────────────────────────────────────
router.delete('/:id',
  requireAuth, requireRole('admin'), csrfProtect,
  newsController.remove);

module.exports = router;
