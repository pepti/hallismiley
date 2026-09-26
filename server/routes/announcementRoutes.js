// Public site announcement (harvest2-lane7a; ported from icelandicstore #200).
// Read-only and anonymous: GET only, under the global limiter. The copy is
// returned only while the announcement is live (controllers/
// announcementController.js); the admin side is routes/adminAnnouncementRoutes.js.
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/announcementController');

// Mounted at /api/v1/announcement.
router.get('/', ctrl.getPublic);

module.exports = router;
