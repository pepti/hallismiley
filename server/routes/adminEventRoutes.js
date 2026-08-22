// Admin read surface for the server-side event log (Admin → Monitoring).
// Read-only: rows are written by the error handler and the client beacon, never
// edited, and they expire on their own (server/services/eventLogCleanup.js).
const express = require('express');
const router  = express.Router();

const ctrl = require('../controllers/eventLogController');
const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');

router.use(requireAuth, requireRole('admin'));

router.get('/', ctrl.list);

module.exports = router;
