const express = require('express');
const router  = express.Router();
const projectController        = require('../controllers/projectController');
const { validateProject, validateQuery } = require('../middleware/validate');
const { requireAuth }          = require('../middleware/auth');

// Public read endpoints (A03: query params validated)
router.get('/',         validateQuery, projectController.getAll);
router.get('/featured', projectController.getFeatured);
router.get('/:id',      projectController.getOne);

// A01 Broken Access Control + A07 Auth: protect all write endpoints
router.post('/',    requireAuth, validateProject, projectController.create);
router.put('/:id',  requireAuth, validateProject, projectController.update);
router.patch('/:id',requireAuth, validateProject, projectController.update); // A03: fixed — validation no longer skipped
router.delete('/:id',requireAuth,                 projectController.remove);

module.exports = router;
