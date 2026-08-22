// Admin CRUD for MCP tokens — the normal admin stack (session auth, admin
// role, CSRF on writes), unlike /api/v1/mcp itself which is bearer-only.
const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/mcpAdminController');
const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');

router.use(requireAuth, requireRole('admin'));

router.get('/', ctrl.list);
router.post('/', csrfProtect, ctrl.create);
router.post('/:id/revoke', csrfProtect, ctrl.revoke);

module.exports = router;
