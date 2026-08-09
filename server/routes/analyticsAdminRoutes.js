// Admin-only analytics dashboard API. All read-only GETs (no CSRF needed).
const express           = require('express');
const router            = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { requireAuth }   = require('../auth/middleware');
const { requireView }   = require('../auth/requireView');

router.use(requireAuth, requireView('analytics'));

router.get('/summary',       analyticsController.summary);
router.get('/timeseries',    analyticsController.timeseries);
router.get('/top-pages',     analyticsController.topPages);
router.get('/top-referrers', analyticsController.topReferrers);
router.get('/devices',       analyticsController.devices);
router.get('/conversions',   analyticsController.conversions);

module.exports = router;
