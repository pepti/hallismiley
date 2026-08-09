'use strict';
const express         = require('express');
const router          = express.Router();
const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');
const ctrl            = require('../controllers/contentController');

// Public — anyone can read site content
router.get('/:key', ctrl.getContent);

// Admin + moderator — update text content
router.put('/:key', requireAuth, requireRole('admin', 'moderator'), csrfProtect, ctrl.putContent);

// Admin + moderator — upload a replacement image (multipart; CSRF token sent as header)
router.post('/:key/image', requireAuth, requireRole('admin', 'moderator'), csrfProtect, ctrl.uploadImage);

module.exports = router;
