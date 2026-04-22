// Admin user-management endpoints.  All routes require role='admin'.
const { query: dbQuery } = require('../config/database');
const { lucia }          = require('../auth/lucia');
const emailService       = require('../services/emailService');
const { t }              = require('../i18n');

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
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const { rows: countRows } = await dbQuery('SELECT COUNT(*)::int AS total FROM users');

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
          error: t(req.locale, 'errors.admin.roleEnum', { values: VALID_ROLES.join(', ') }),
          code: 400,
        });
      }

      // Prevent admin from demoting themselves
      if (id === req.user.id) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.cannotChangeOwnRole'), code: 400 });
      }

      const { rows } = await dbQuery(
        `UPDATE users SET role = $1 WHERE id = $2
         RETURNING id, username, email, role`,
        [role, id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
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
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
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
        return res.status(400).json({ error: t(req.locale, 'errors.admin.cannotDisableSelf'), code: 400 });
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
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
      }

      // If disabling, invalidate all their active sessions immediately
      if (disabled) {
        await lucia.invalidateUserSessions(id);
      }

      return res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/email-health
  // Reports whether outbound email notifications can be delivered. Fire-and-
  // forget RSVP emails fail silently; this endpoint surfaces the underlying
  // config so admins can spot "notifications are broken" before missing RSVPs.
  async getEmailHealth(req, res, next) {
    try {
      const envHealth = emailService.emailHealthCheck();

      const { rows: adminRows } = await dbQuery(
        `SELECT email, email_verified FROM users
          WHERE role = 'admin' AND disabled = FALSE
          ORDER BY email`
      );

      const adminEmails = adminRows.map(r => ({
        email:    r.email,
        verified: r.email_verified,
      }));
      const anyVerified = adminEmails.some(a => a.verified);

      return res.json({
        ...envHealth,
        adminEmails,
        anyAdminVerified: anyVerified,
        healthy: envHealth.resendConfigured && anyVerified,
      });
    } catch (err) { next(err); }
  },

  // DELETE /api/v1/admin/users/:id  — hard delete (removes row permanently)
  async deleteUser(req, res, next) {
    try {
      const { id } = req.params;

      if (id === req.user.id) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.cannotDeleteSelf'), code: 400 });
      }

      // Invalidate sessions before deleting so Lucia doesn't error on missing user
      await lucia.invalidateUserSessions(id);

      const { rows } = await dbQuery(
        'DELETE FROM users WHERE id = $1 RETURNING id',
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
      }

      return res.status(204).send();
    } catch (err) { next(err); }
  },
};

module.exports = adminController;
