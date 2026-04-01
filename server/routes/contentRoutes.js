const express    = require('express');
const router     = express.Router();

const siteContentController = require('../controllers/siteContentController');
const { requireAuth }       = require('../auth/middleware');
const { requireRole }       = require('../auth/roles');
const { csrfProtect }       = require('../middleware/csrf');

// Public — returns all homepage content key/value pairs
router.get('/', siteContentController.getAll);

// Admin / moderator — upsert content key/value pairs
router.patch('/',
  requireAuth, requireRole('admin', 'moderator'), csrfProtect,
  siteContentController.update);

module.exports = router;
