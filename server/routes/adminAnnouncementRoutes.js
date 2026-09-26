// Admin → Tilkynning (the site announcement; harvest2-lane7a, ported from
// icelandicstore #200). requireAuth + the screen's own view id
// ('announcement', core — no module owns it), CSRF + sanitizeBody on the
// write; app.js puts the write under writeLimiter. The public read is
// routes/announcementRoutes.js.
const express = require('express');
const router  = express.Router();

const ctrl             = require('../controllers/adminAnnouncementController');
const { requireAuth }  = require('../auth/middleware');
const { requireView }  = require('../auth/requireView');
const { csrfProtect }  = require('../middleware/csrf');
const { sanitizeBody } = require('../middleware/sanitize');

router.use(requireAuth, requireView('announcement'));

// Mounted at /api/v1/admin/announcement.
router.get('/', ctrl.get);
router.patch('/', csrfProtect, sanitizeBody, ctrl.update);

module.exports = router;
