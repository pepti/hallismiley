// Admin-only analytics dashboard API. All read-only GETs (no CSRF needed).
const express           = require('express');
const router            = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { requireAuth }   = require('../auth/middleware');
const { requireRole }   = require('../auth/roles');

router.use(requireAuth);

router.get('/summary',       requireRole('admin'), analyticsController.summary);
router.get('/timeseries',    requireRole('admin'), analyticsController.timeseries);
router.get('/top-pages',     requireRole('admin'), analyticsController.topPages);
router.get('/top-referrers', requireRole('admin'), analyticsController.topReferrers);
router.get('/devices',       requireRole('admin'), analyticsController.devices);
router.get('/conversions',   requireRole('admin'), analyticsController.conversions);

module.exports = router;
