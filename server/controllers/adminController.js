// Admin user-management endpoints.  All routes require role='admin'.
const { query: dbQuery, pool } = require('../config/database');
const { lucia }          = require('../auth/lucia');
const emailService       = require('../services/emailService');
const { t }              = require('../i18n');
const Role               = require('../models/Role');
const UserRole           = require('../models/UserRole');
const { declineGuest, sendWelcome } = require('../services/partyApproval');
// Disabling/enabling an account is a staff action (migration 098); best-effort.
const staffAudit         = require('../services/staffAudit');
const securityLogger     = require('../observability/securityLogger');
const mfaService         = require('../services/mfaService');
const McpToken           = require('../models/McpToken');
const { Scrypt }         = require('oslo/password');
const { generatePassword } = require('../utils/generatePassword');
const { parseExpiresAt } = require('../auth/accountExpiry');
// A name-only login's reserved <username>@noemail.invalid is never shown or
// searched as an address (ice #397): the list reads it as NULL + no_email.
const { isPlaceholderEmail, realEmailSql, realEmailExpr } = require('../utils/placeholderEmail');
const EMAIL_SHOWN = realEmailExpr('email');

// Only an admin may hold an MCP token (mcpAdminRoutes mints them; mcp/owner.js
// refuses a non-admin owner on every call). When an account stops being an
// admin, or is disabled, its rows are revoked too so Admin → MCP tells the
// truth (ice #418). Best-effort after the change has committed.
async function revokeMcpTokens(req, userId, reason) {
  try {
    const revoked = await McpToken.revokeAllForUser(userId);
    if (revoked) securityLogger.adminAction(req.user.id, 'mcp_tokens_revoked', userId, { count: revoked, reason });
    return revoked;
  } catch (err) {
    securityLogger.alert('warning', 'MCP token revocation failed', { userId, reason, err: err.message });
    return 0;
  }
}

// Does this account hold staff standing — admin or moderator, or any role that
// grants an admin view (a seller, a contractor, a custom role)? A 2FA reset on
// such an account asks for the ACTING admin's own password (ice #396; ice keys
// it on admin/moderator — the engine's dynamic roles make any view holder staff).
async function isStaffAccount(userId) {
  const { rows } = await dbQuery(
    `SELECT 1
       FROM roles r
      WHERE (r.name = (SELECT role FROM users WHERE id = $1)
             OR r.name IN (SELECT role_name FROM user_roles WHERE user_id = $1))
        AND (r.name IN ('admin', 'moderator') OR jsonb_array_length(r.view_access) > 0)
      LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

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
        ? `WHERE (username ILIKE $1 OR ${EMAIL_SHOWN} ILIKE $1 OR display_name ILIKE $1)`
        : '';
      const term = q ? [`%${q}%`] : []; // $1 when present

      const { rows } = await dbQuery(
        `SELECT id, username, ${EMAIL_SHOWN} AS email, NOT (${realEmailSql('email')}) AS no_email,
                role, avatar, display_name,
                email_verified, disabled, disabled_at, disabled_reason,
                party_access, approval_status, requested_at, created_at, last_login_at,
                totp_enabled, expires_at
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

      // The dropdown sets the user's role to EXACTLY this one. Do the last-admin
      // guard + mutation in ONE transaction with a row lock on the admin set, so
      // two concurrent demotions can't both pass the check and leave zero admins,
      // and the role swap (UPDATE primary → trigger adds membership → DELETE the
      // rest) can never be left half-applied.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (role !== 'admin') {
          // Lock the live admin membership rows; concurrent demotions serialize
          // here. Fresh read (not the per-user cache) — see UserRole cache notes.
          const { rows: admins } = await client.query(
            `SELECT ur.user_id
               FROM user_roles ur JOIN users u ON u.id = ur.user_id
              WHERE ur.role_name = 'admin' AND u.disabled = FALSE
              FOR UPDATE`
          );
          const adminIds = admins.map(r => r.user_id);
          if (adminIds.includes(id) && adminIds.length <= 1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: t(req.locale, 'errors.admin.lastAdmin'), code: 400 });
          }
        }

        const { rows } = await client.query(
          `UPDATE users SET role = $1 WHERE id = $2
           RETURNING id, username, email, role`,
          [role, id]
        );
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
        }

        // Trigger added the new role membership; drop the others so the dropdown
        // stays single-role (the Members tab manages multi-role).
        await client.query('DELETE FROM user_roles WHERE user_id = $1 AND role_name <> $2', [id, role]);
        await client.query('COMMIT');
        UserRole.invalidateUser(id); // clear the cached set after the commit
        if (role !== 'admin') await revokeMcpTokens(req, id, 'role_change');
        return res.json(rows[0]);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
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
      // link can't silently re-grant entry. Only the HASH is cleared —
      // magic_login_token_created_at must survive: partyController.requestAccess
      // uses it to detect revoked guests and route them to manual review
      // instead of auto-granting.
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

  // PATCH /api/v1/admin/users/:id/approve — send the party-info ("welcome")
  // email to a guest. For manual-review guests (declined/revoked re-requests)
  // sendWelcome first re-grants access and emails a fresh magic link. Repeat
  // calls re-send the info email.
  async approveUser(req, res, next) {
    try {
      const { id } = req.params;
      const user = await sendWelcome(id, { sentBy: req.user.id });
      if (!user) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
      }
      res.json({
        id:                    user.id,
        username:              user.username,
        email:                 user.email,
        party_access:          user.party_access,
        approval_status:       user.approval_status,
        welcome_email_sent_at: user.welcome_email_sent_at,
      });
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

  // POST /api/v1/admin/users/:id/totp/reset  { password? }
  // Turn another user's two-step verification off: secret, recovery codes and
  // the replay marker all go (mfaService.disable, the same teardown the owner's
  // own turn-off uses). Their password is untouched, so they sign in with it
  // alone and can set 2FA up again from their profile. The way back in for
  // someone who lost their phone AND their recovery codes (ice #396).
  //
  // Refused for your own account: the self-service turn-off re-checks the
  // password so a walk-up attacker at an unlocked, signed-in laptop cannot strip
  // the second factor, and this route would skip that check.
  //
  // Staff targets (isStaffAccount) also need the ACTING admin's own password in
  // the body — the same re-check (mfaService.verifyPassword). Otherwise a walk-up
  // attacker at one admin's laptop could strip another staff account's second
  // factor. A plain customer account needs none.
  //
  // Every session the target holds is ended, as disabling does. Idempotent:
  // resetting an account with no 2FA answers { enabled: false } too, and still
  // clears a half-finished enrolment's secret.
  async resetTotp(req, res, next) {
    try {
      const { id } = req.params;
      if (id === req.user.id) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.cannotResetOwnTotp'), code: 400 });
      }
      const { rows } = await dbQuery('SELECT id, username, role, totp_enabled FROM users WHERE id = $1', [id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
      }

      const target = rows[0];
      if (await isStaffAccount(id)) {
        const password = req.body?.password;
        if (!password) {
          // `reason` lets the Users page ask for the password and retry.
          return res.status(400).json({ error: t(req.locale, 'errors.admin.totpResetPasswordRequired'), code: 400, reason: 'password_required' });
        }
        if (!(await mfaService.verifyPassword(req.user.id, password))) {
          securityLogger.loginFailed(req.ip, `${req.user.username} failed password check resetting 2FA for ${id}`);
          return res.status(403).json({ error: t(req.locale, 'errors.admin.totpResetPasswordWrong'), code: 403 });
        }
      }

      await mfaService.disable(id);
      await lucia.invalidateUserSessions(id);
      securityLogger.adminAction(req.user.id, 'totp_reset', id,
        { wasEnabled: target.totp_enabled, targetRole: target.role, ip: req.ip });
      await staffAudit.recordSafe({
        ...staffAudit.actorOf(req), action: 'user.totp_reset',
        entityType: 'user', entityId: id, summary: { username: target.username },
      });
      return res.json({ enabled: false });
    } catch (err) { next(err); }
  },

  // POST /api/v1/admin/users/:id/new-password — replace a MAILBOX-LESS login's
  // password (ice #382/#397): the only way back in when the one shown at create
  // time is lost, since there is nowhere to send a reset link. Answers with the
  // new password ONCE (no-store); it is never logged or stored in the clear.
  //
  // The ADDRESS decides, not the role: only a login created without a mailbox
  // (a reserved placeholder address, which the admin UI can never set) qualifies
  // — otherwise an admin could mint a password for a colleague's real account,
  // read it off the screen and impersonate them. And never a staff account
  // (isStaffAccount): staff always set their own password.
  async newPassword(req, res, next) {
    try {
      const { id } = req.params;
      const { rows } = await dbQuery('SELECT id, username, role, email FROM users WHERE id = $1', [id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
      }
      if (!isPlaceholderEmail(rows[0].email) || await isStaffAccount(id)) {
        return res.status(409).json({ error: t(req.locale, 'errors.admin.hasMailbox'), code: 409 });
      }
      const password = generatePassword();
      await dbQuery(
        `UPDATE users
            SET password_hash = $1,
                password_reset_token = NULL, password_reset_expires = NULL,
                failed_login_attempts = 0, locked_until = NULL
          WHERE id = $2`,
        [await new Scrypt().hash(password), id]
      );
      await lucia.invalidateUserSessions(id);
      // Who replaced a credential, and when — never the password itself.
      securityLogger.adminAction(req.user.id, 'name_only_password_rotated', id, { role: rows[0].role });
      await staffAudit.recordSafe({
        ...staffAudit.actorOf(req), action: 'user.password_replaced',
        entityType: 'user', entityId: id, summary: { username: rows[0].username },
      });
      res.set('Cache-Control', 'no-store');
      return res.json({ username: rows[0].username, password });
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

      // If disabling, invalidate all their active sessions — and their MCP
      // tokens, the other credential an admin can hold — immediately.
      if (disabled) {
        await lucia.invalidateUserSessions(id);
        await revokeMcpTokens(req, id, 'disabled');
      }
      await staffAudit.recordSafe({
        ...staffAudit.actorOf(req), action: disabled ? 'user.disabled' : 'user.enabled',
        entityType: 'user', entityId: id, summary: { username: rows[0].username },
      });

      return res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/users/:id/expiry  { expires_at }
  //
  // Time-limited logins (login-expiry-2026-09-26, migration 114): set when
  // another account's login stops working — an ISO date-time, a bare
  // YYYY-MM-DD (the end of that day, UTC), or null to clear it. A new value
  // must lie in the future (auth/accountExpiry.js parseExpiresAt); ending a
  // login NOW is what `disable` is for. Never your own account: an admin who
  // time-limits themself locks the instance's door behind them.
  async setExpiry(req, res, next) {
    try {
      const { id } = req.params;
      if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'expires_at')) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.expiresAtInvalid'), code: 400 });
      }
      if (id === req.user.id) {
        return res.status(400).json({ error: t(req.locale, 'errors.admin.cannotExpireSelf'), code: 400 });
      }
      const parsed = parseExpiresAt(req.body.expires_at);
      if (!parsed.ok) {
        return res.status(400).json({ error: t(req.locale, parsed.messageKey), code: 400 });
      }

      const { rows } = await dbQuery(
        `UPDATE users SET expires_at = $1 WHERE id = $2
         RETURNING id, username, expires_at`,
        [parsed.value, id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.admin.userNotFound'), code: 404 });
      }

      await staffAudit.recordSafe({
        ...staffAudit.actorOf(req),
        action: parsed.value ? 'user.expiry_set' : 'user.expiry_cleared',
        entityType: 'user', entityId: id,
        summary: { username: rows[0].username, expires_at: parsed.value ? parsed.value.toISOString() : null },
      });
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
          WHERE id IN (SELECT user_id FROM user_roles WHERE role_name = 'admin') AND disabled = FALSE
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

      // The row (and its user_roles via ON DELETE CASCADE) is gone — drop the
      // cached role set so a recreated id can't read a stale entry.
      UserRole.invalidateUser(id);

      return res.status(204).send();
    } catch (err) { next(err); }
  },
};

module.exports = adminController;
