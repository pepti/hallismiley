// Staff audit log — /api/v1/admin/audit (migration 098). Admin-only read of
// the append-only staff_audit_log; rendered on /admin/monitoring. The
// account-scoped slice lives on /api/v1/admin/accounts/:id/audit.
const express = require('express');
const router  = express.Router();

const staffAudit = require('../services/staffAudit');
const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');

router.use(requireAuth, requireRole('admin'));

// GET /?action=&entityType=&entityId=&q=&limit=&offset=
router.get('/', async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const out = await staffAudit.list({
      action: req.query.action || null,
      entityType: req.query.entityType || null,
      entityId: req.query.entityId || null,
      q: (req.query.q && String(req.query.q).trim().slice(0, 100)) || null,
      limit: req.query.limit, offset: req.query.offset,
    });
    return res.json({ ...out, actions: staffAudit.ACTIONS });
  } catch (err) { next(err); }
});

module.exports = router;
