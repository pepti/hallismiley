// Admin read surface for the server-side event log (Admin → Monitoring).
// Read-only: rows are written by the error handler and the client beacon, never
// edited, and they expire on their own (server/services/eventLogCleanup.js).
const express = require('express');
const router  = express.Router();

const ctrl = require('../controllers/eventLogController');
const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { runReadinessChecks, readinessBody } = require('../observability/readiness');

router.use(requireAuth, requireRole('admin'));

router.get('/', ctrl.list);

// Full readiness report for Admin → Monitoring. Public /ready withholds the
// `checks` detail from anyone without the /metrics credential, and an admin's
// browser has neither — so the screen reads it here, behind the admin gate.
router.get('/health', async (req, res, next) => {
  try {
    const report = await runReadinessChecks();
    res.set('Cache-Control', 'no-store');
    res.status(report.ok ? 200 : 503).json(readinessBody(report, true));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
