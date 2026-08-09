// Admin roles management — CRUD on dynamic roles + their admin view access.
// Mounted HARD admin-only (server/routes/adminRolesRoutes.js): managing roles is
// a meta-permission and is NEVER gated by requireView, to prevent a custom role
// from granting itself more access (privilege escalation).
const Role = require('../models/Role');
const UserRole = require('../models/UserRole');
const { query: dbQuery, pool } = require('../config/database');
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

  // GET /api/v1/admin/roles/members — every role with its members (multi-role).
  // Powers the admin "Members" board. Roles with no members still appear (empty),
  // so the board always renders a column per role.
  async listMembers(req, res, next) {
    try {
      const [roles, byRole] = await Promise.all([Role.findAll(), UserRole.membersByRole()]);
      const out = roles.map(r => ({
        name:        r.name,
        description: r.description,
        is_system:   r.is_system,
        view_access: r.view_access,
        members:     byRole.get(r.name) || [],
      }));
      return res.json({ roles: out });
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/roles/:name/members  { userId } — grant a role (membership).
  async addMember(req, res, next) {
    try {
      const { name } = req.params;
      const userId = String(req.body?.userId || '').trim();
      if (!userId) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.userIdRequired'), code: 400 });
      }
      const role = await Role.findByName(name);
      if (!role) return res.status(404).json({ error: t(req.locale, 'errors.admin.roleNotFound'), code: 404 });

      const { rows: u } = await dbQuery('SELECT id FROM users WHERE id = $1', [userId]);
      if (!u.length) return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });

      const added = await UserRole.add(userId, name, req.user.id);
      if (!added) {
        return res.status(409).json({ error: t(req.locale, 'errors.admin.alreadyMember'), code: 409 });
      }
      return res.status(201).json({ ok: true });
    } catch (err) {
      if (err.code === '23503') { // user/role vanished mid-request
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
      }
      next(err);
    }
  },

  // DELETE /api/v1/admin/roles/:name/members/:userId — revoke a role (membership).
  // Guards: never strip the last admin; never let an admin drop their own admin
  // role (self-lockout). If the removed role was the user's primary (users.role),
  // repoint the primary to their highest-precedence remaining role (floor 'user').
  async removeMember(req, res, next) {
    try {
      const { name, userId } = req.params;

      if (userId === req.user.id && name === 'admin') {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.cannotChangeOwnRole'), code: 400 });
      }

      // Guard + delete + primary-repoint in ONE transaction with a row lock on
      // the admin set, so two concurrent removals can't both pass the last-admin
      // check and leave zero admins, and the repoint can't be left half-applied.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (name === 'admin') {
          const { rows: admins } = await client.query(
            `SELECT ur.user_id
               FROM user_roles ur JOIN users u ON u.id = ur.user_id
              WHERE ur.role_name = 'admin' AND u.disabled = FALSE
              FOR UPDATE`
          );
          const adminIds = admins.map(r => r.user_id);
          if (adminIds.includes(userId) && adminIds.length <= 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: t(req.locale, 'errors.admin.lastAdmin'), code: 400 });
          }
        }

        const { rowCount } = await client.query(
          'DELETE FROM user_roles WHERE user_id = $1 AND role_name = $2',
          [userId, name]
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
        }

        // If we removed the user's primary role, repoint it to the highest-
        // precedence remaining role, restoring the 'user' floor if none remain.
        const { rows: u } = await client.query('SELECT role FROM users WHERE id = $1', [userId]);
        if (u.length && u[0].role === name) {
          const { rows: rem } = await client.query(
            'SELECT role_name FROM user_roles WHERE user_id = $1', [userId]
          );
          let remaining = rem.map(r => r.role_name);
          if (!remaining.length) {
            await client.query(
              `INSERT INTO user_roles (user_id, role_name, granted_by)
               VALUES ($1, 'user', $2) ON CONFLICT DO NOTHING`,
              [userId, req.user.id]
            );
            remaining = ['user'];
          }
          await client.query('UPDATE users SET role = $1 WHERE id = $2', [UserRole.pickPrimary(remaining), userId]);
        }

        await client.query('COMMIT');
        UserRole.invalidateUser(userId);
        return res.status(204).send();
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  },
};

module.exports = adminRolesController;
