// The admin's module switches — /api/v1/admin/modules (R5b, 2026-09-24).
//
// The human side of the MCP `set_module` tool: the same rule
// (config/modules.js setModuleSwitch — a contracted module may be switched
// off and back on, never one the contract leaves out), so whatever Claude
// switched off, an admin can see here and switch back without Claude. The
// normal admin stack: session auth, the `admin` role, CSRF on the write.
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');
const { moduleSummary, setModuleSwitch } = require('../config/modules');
const { MODULE_IDS } = require('../config/moduleCatalog');
const securityLogger = require('../observability/securityLogger');

router.use(requireAuth, requireRole('admin'));

function listing() {
  const s = moduleSummary();
  return {
    preset: s.preset,
    modules: MODULE_IDS.map((id) => ({
      id,
      contract: s.contract.includes(id),
      enabled: s.enabled.includes(id),
    })),
  };
}

// GET / → { preset, modules: [{ id, contract, enabled }] }
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json(listing());
});

// PATCH /:id { enabled: boolean }
router.patch('/:id', csrfProtect, async (req, res, next) => {
  try {
    const enabled = req.body && req.body.enabled;
    const result = await setModuleSwitch(req.params.id, enabled);
    if (!result.ok) return res.status(400).json({ error: result.error, code: 400 });
    securityLogger.adminAction(req.user.id, 'module_switched', req.params.id, { enabled });
    return res.json(listing());
  } catch (err) { return next(err); }
});

module.exports = router;
