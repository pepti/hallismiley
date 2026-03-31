const express = require('express');
const router  = express.Router();
const projectController               = require('../controllers/projectController');
const { validateProject, validateQuery } = require('../middleware/validate');
const { requireAuth }                 = require('../middleware/auth');
const { requireRole }                 = require('../auth/roles');
const { csrfProtect }                 = require('../middleware/csrf');

// Public read endpoints (A03: query params validated)
router.get('/',         validateQuery, projectController.getAll);
router.get('/featured', projectController.getFeatured);
router.get('/:id',      projectController.getOne);

// Create / update: admin or moderator
router.post('/',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateProject,
  projectController.create);

router.put('/:id',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateProject,
  projectController.update);

router.patch('/:id',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect, validateProject,
  projectController.update);

// Delete: admin only
router.delete('/:id',
  requireAuth, requireRole('admin'), csrfProtect,
  projectController.remove);

module.exports = router;
