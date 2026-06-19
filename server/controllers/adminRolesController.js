// Admin roles management — CRUD on dynamic roles + their admin view access.
// Mounted HARD admin-only (server/routes/adminRolesRoutes.js): managing roles is
// a meta-permission and is NEVER gated by requireView, to prevent a custom role
// from granting itself more access (privilege escalation).
const Role = require('../models/Role');
const { GRANTABLE_VIEW_IDS } = require('../auth/adminViews');
const { t } = require('../i18n');

const NAME_RE  = /^[a-z0-9_-]{2,32}$/;
const RESERVED = new Set(['admin', 'moderator', 'user']);

// Returns null when valid, else an English error string.
function validateViewAccess(v) {
  if (!Array.isArray(v)) return 'view_access must be an array';
  if (v.length > GRANTABLE_VIEW_IDS.length) return 'too many views';
  for (const id of v) {
    if (typeof id !== 'string' || !GRANTABLE_VIEW_IDS.includes(id)) return `invalid view: ${id}`;
  }
  return null;
}

const adminRolesController = {
  async list(req, res, next) {
    try {
      const roles = await Role.findAll();
      return res.json({ roles, grantableViews: GRANTABLE_VIEW_IDS });
    } catch (err) { next(err); }
  },

  async create(req, res, next) {
    try {
      const { name, description, view_access } = req.body || {};
      if (typeof name !== 'string' || !NAME_RE.test(name)) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.roleNameInvalid'), code: 400 });
      }
      if (RESERVED.has(name)) {
        return res.status(409).json({ error: t(req.locale, 'errors.admin.roleNameReserved'), code: 409 });
      }
      const verr = validateViewAccess(view_access ?? []);
      if (verr) return res.status(400).json({ error: verr, code: 400 });
      const role = await Role.create({
        name,
        description: typeof description === 'string' ? description.slice(0, 200) : '',
        view_access: [...new Set(view_access || [])],
      });
      return res.status(201).json({ role });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: t(req.locale, 'errors.admin.roleNameTaken'), code: 409 });
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const { name } = req.params;
      const role = await Role.findByName(name);
      if (!role) return res.status(404).json({ error: t(req.locale, 'errors.admin.roleNotFound'), code: 404 });
      // The admin role is always all-access — its view_access can't be edited.
      if (name === 'admin' && req.body.view_access !== undefined) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.cannotEditAdminAccess'), code: 400 });
      }
      if (req.body.view_access !== undefined) {
        const verr = validateViewAccess(req.body.view_access);
        if (verr) return res.status(400).json({ error: verr, code: 400 });
      }
      const updated = await Role.update(name, {
        description: typeof req.body.description === 'string' ? req.body.description.slice(0, 200) : undefined,
        view_access: req.body.view_access !== undefined ? [...new Set(req.body.view_access)] : undefined,
      });
      return res.json({ role: updated });
    } catch (err) { next(err); }
  },

  async remove(req, res, next) {
    try {
      const { name } = req.params;
      const role = await Role.findByName(name);
      if (!role) return res.status(404).json({ error: t(req.locale, 'errors.admin.roleNotFound'), code: 404 });
      if (role.is_system) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.cannotDeleteSystemRole'), code: 400 });
      }
      try {
        await Role.remove(name);
      } catch (err) {
        if (err.code === '23503') { // FK violation — role still assigned to users
          return res.status(409).json({ error: t(req.locale, 'errors.admin.roleInUse'), code: 409 });
        }
        throw err;
      }
      return res.status(204).send();
    } catch (err) { next(err); }
  },
};

module.exports = adminRolesController;
