// Admin user-management endpoints.  All routes require role='admin'.
const { query: dbQuery } = require('../config/database');
const { lucia }          = require('../auth/lucia');

const VALID_ROLES = ['admin', 'moderator', 'user'];

const adminController = {
  // GET /api/v1/admin/users?limit=20&offset=0
  async listUsers(req, res, next) {
    try {
      const limit  = Math.min(Math.max(Number(req.query.limit)  || 20, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const { rows } = await dbQuery(
        `SELECT id, username, email, role, avatar, display_name,
                email_verified, disabled, disabled_at, disabled_reason,
                party_access, created_at, last_login_at
         FROM users
         WHERE disabled_reason IS DISTINCT FROM 'Deleted by admin'
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const { rows: countRows } = await dbQuery(
        `SELECT COUNT(*)::int AS total FROM users
         WHERE disabled_reason IS DISTINCT FROM 'Deleted by admin'`
      );

      return res.json({
        users: rows,
        total: countRows[0].total,
        limit,
        offset,
      });
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/users/:id/role  { role }
  async changeRole(req, res, next) {
    try {
      const { id } = req.params;
      const { role } = req.body;

      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({
          error: `role must be one of: ${VALID_ROLES.join(', ')}`,
          code: 400,
        });
      }

      // Prevent admin from demoting themselves
      if (id === req.user.id) {
        return res.status(400).json({ error: 'Cannot change your own role', code: 400 });
      }

      const { rows } = await dbQuery(
        `UPDATE users SET role = $1 WHERE id = $2
         RETURNING id, username, email, role`,
        [role, id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found', code: 404 });
      }

      return res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/users/:id/party-access  { party_access: boolean }
  async setPartyAccess(req, res, next) {
    try {
      const { id } = req.params;
      const { party_access } = req.body;
      if (typeof party_access !== 'boolean') {
        return res.status(400).json({ error: 'party_access must be a boolean', code: 400 });
      }
      const { rows } = await dbQuery(
        `UPDATE users SET party_access = $1 WHERE id = $2
         RETURNING id, username, email, party_access`,
        [party_access, id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found', code: 404 });
      }
      return res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/users/:id/disable  { disabled, reason? }
  async disableUser(req, res, next) {
    try {
      const { id } = req.params;
      const { disabled, reason } = req.body;

      if (typeof disabled !== 'boolean') {
        return res.status(400).json({ error: 'disabled must be a boolean', code: 400 });
      }

      // Prevent admin from disabling themselves
      if (id === req.user.id) {
        return res.status(400).json({ error: 'Cannot disable your own account', code: 400 });
      }

      const disabledAt     = disabled ? new Date() : null;
      const disabledReason = disabled ? (reason ?? null) : null;

      const { rows } = await dbQuery(
        `UPDATE users
         SET disabled = $1, disabled_at = $2, disabled_reason = $3
         WHERE id = $4
         RETURNING id, username, email, role, disabled, disabled_at, disabled_reason`,
        [disabled, disabledAt, disabledReason, id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found', code: 404 });
      }

      // If disabling, invalidate all their active sessions immediately
      if (disabled) {
        await lucia.invalidateUserSessions(id);
      }

      return res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // DELETE /api/v1/admin/users/:id  — soft delete (disable, not hard delete)
  async deleteUser(req, res, next) {
    try {
      const { id } = req.params;

      if (id === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account', code: 400 });
      }

      const { rows } = await dbQuery(
        `UPDATE users
         SET disabled = TRUE, disabled_at = NOW(), disabled_reason = 'Deleted by admin'
         WHERE id = $1
         RETURNING id`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found', code: 404 });
      }

      await lucia.invalidateUserSessions(id);

      return res.status(204).send();
    } catch (err) { next(err); }
  },
};

module.exports = adminController;
