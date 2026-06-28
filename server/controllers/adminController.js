// Admin user-management endpoints.  All routes require role='admin'.
const { query: dbQuery } = require('../config/database');
const { lucia }          = require('../auth/lucia');
const emailService       = require('../services/emailService');
const { t }              = require('../i18n');
const Role               = require('../models/Role');
const logger             = require('../logger');
const { approveGuest, declineGuest } = require('../services/partyApproval');

const adminController = {
  // GET /api/v1/admin/users?limit=20&offset=0&sort=username&order=asc&q=foo
  async listUsers(req, res, next) {
    try {
      const limit  = Math.min(Math.max(Number(req.query.limit)  || 20, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      // Whitelist sortable columns → SQL (column names can't be parameterized).
      // LOWER() gives a case-insensitive sort on the text columns.
      const SORTS = {
        username:   'LOWER(username)',
        email:      'LOWER(email)',
        role:       'role',
        verified:   'email_verified',
        status:     'disabled',
        party:      'party_access',
        created_at: 'created_at',
      };
      const sortCol = SORTS[req.query.sort] || 'created_at';
      const dir     = String(req.query.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

      // Optional search filter (parameterized). The SAME WHERE drives both the
      // rows query and the count query, or pagination's total wouldn't match
      // the filtered set.
      const q = String(req.query.q || '').trim(); // String() guards array params (?q=a&q=b)
      const whereSql = q
        ? 'WHERE (username ILIKE $1 OR email ILIKE $1 OR display_name ILIKE $1)'
        : '';
      const term = q ? [`%${q}%`] : []; // $1 when present

      const { rows } = await dbQuery(
        `SELECT id, username, email, role, avatar, display_name,
                email_verified, disabled, disabled_at, disabled_reason,
                party_access, approval_status, requested_at, created_at, last_login_at
         FROM users
         ${whereSql}
         ORDER BY ${sortCol} ${dir}, id DESC
         LIMIT $${term.length + 1} OFFSET $${term.length + 2}`,
        [...term, limit, offset]
      );

      const { rows: countRows } = await dbQuery(
        `SELECT COUNT(*)::int AS total FROM users ${whereSql}`,
        term
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

      // Validate against the live roles table (dynamic roles).
      const roleRow = await Role.findByName(role);
      if (!roleRow) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.roleNotFound'), code: 400 });
      }

      // Prevent admin from demoting themselves
      if (id === req.user.id) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.cannotChangeOwnRole'), code: 400 });
      }

      // Last-admin guard: never let the final admin be demoted away from 'admin'.
      if (role !== 'admin') {
        const { rows: tgt } = await dbQuery('SELECT role FROM users WHERE id = $1', [id]);
        if (tgt.length && tgt[0].role === 'admin') {
          const { rows: ac } = await dbQuery(
            `SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND disabled = FALSE`
          );
          if (ac[0].n <= 1) {
            return res.status(400).json({ error: t(req.locale, 'errors.admin.lastAdmin'), code: 400 });
          }
        }
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
      // Revoking access also nulls the magic-login token so a forwarded invite
      // link can't silently re-grant entry.
      const { rows } = await dbQuery(
        `UPDATE users
            SET party_access = $1,
                magic_login_token_hash = CASE WHEN $1 = FALSE THEN NULL ELSE magic_login_token_hash END
          WHERE id = $2
          RETURNING id, username, email, party_access`,
        [party_access, id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
      }
      return res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/users/:id/approve — approve a pending party guest, grant
  // access, and email them their magic link (fire-and-forget).
  async approveUser(req, res, next) {
    try {
      const { id } = req.params;
      const result = await approveGuest(id, { approvedBy: req.user.id });
      if (!result) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
      }
      res.json({
        id:              result.user.id,
        username:        result.user.username,
        email:           result.user.email,
        party_access:    result.user.party_access,
        approval_status: result.user.approval_status,
      });

      emailService.sendPartyInviteEmail({
        to:     result.user.email,
        name:   result.user.display_name,
        token:  result.magicToken,
        locale: result.user.preferred_locale || 'en',
      }).catch(err => logger.error({ err }, 'party invite email failed (admin approve)'));
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/users/:id/decline — decline a pending party guest.
  async declineUser(req, res, next) {
    try {
      const { id } = req.params;
      const user = await declineGuest(id, { approvedBy: req.user.id });
      if (!user) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
      }
      return res.json({
        id:              user.id,
        username:        user.username,
        email:           user.email,
        party_access:    user.party_access,
        approval_status: user.approval_status,
      });
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
