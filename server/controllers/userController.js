// User profile management — self-service endpoints for authenticated users.
const fs   = require('fs');
const path = require('path');
const { query: dbQuery } = require('../config/database');
const { Scrypt }         = require('oslo/password');
const { userAvatarDir }  = require('../config/paths');
const { t }              = require('../i18n');

const scrypt = new Scrypt();

const PROFILE_FIELDS = 'id, username, email, role, avatar, display_name, phone, email_verified, preferred_locale, created_at';
const { SUPPORTED_LOCALES } = require('../config/i18n');

// Only delete files that match the user-upload pattern (never the baked SVGs).
const UPLOADED_AVATAR_RE = /^user-\d+-\d+-[a-z0-9]+\.(jpg|jpeg|png|webp)$/i;
function _tryUnlinkAvatar(filename) {
  if (!filename || !UPLOADED_AVATAR_RE.test(filename)) return;
  try { fs.unlinkSync(path.join(userAvatarDir(), filename)); } catch { /* ignore */ }
}

const userController = {
  // GET /api/v1/users/me
  async getMe(req, res, next) {
    try {
      const { rows } = await dbQuery(
        `SELECT ${PROFILE_FIELDS} FROM users WHERE id = $1`,
        [req.user.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.user.userNotFound'), code: 404 });
      }
      return res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/users/me  { username?, display_name?, phone?, avatar? }
  // Field validation handled upstream by validateProfileUpdate middleware.
  async updateMe(req, res, next) {
    try {
      const allowed  = ['username', 'display_name', 'phone', 'avatar', 'preferred_locale'];
      const updates  = {};
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.user.noUpdatableFields'), code: 400 });
      }

      if ('preferred_locale' in updates && !SUPPORTED_LOCALES.includes(updates.preferred_locale)) {
        return res.status(400).json({ error: t(req.locale, 'errors.user.unsupportedLocale'), code: 400 });
      }

      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
      const values     = [req.user.id, ...Object.values(updates)];

      let rows;
      try {
        // Case-insensitive uniqueness on username is enforced by the
        // users_username_lower_idx unique index (migration 041). Letting
        // the DB enforce it atomically removes the read-then-write race.
        ({ rows } = await dbQuery(
          `UPDATE users SET ${setClauses.join(', ')} WHERE id = $1
           RETURNING ${PROFILE_FIELDS}`,
          values
        ));
      } catch (err) {
        if (err.code === '23505' && 'username' in updates) {
          return res.status(409).json({ error: t(req.locale, 'errors.auth.usernameTaken'), code: 409 });
        }
        throw err;
      }

      return res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // POST /api/v1/users/me/avatar  (multipart, field: file)
  // Stores the uploaded image under UPLOAD_ROOT/avatars and sets users.avatar
  // to the new filename. Deletes the prior uploaded avatar (if any) on success.
  async uploadAvatar(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: t(req.locale, 'errors.user.noFileUploaded'), code: 400 });
      }

      // Look up previous avatar so we can clean up if it was a user upload.
      const { rows: prevRows } = await dbQuery(
        'SELECT avatar FROM users WHERE id = $1',
        [req.user.id]
      );
      const previous = prevRows[0]?.avatar;

      const newName = req.file.filename;
      const { rows } = await dbQuery(
        `UPDATE users SET avatar = $1 WHERE id = $2
         RETURNING ${PROFILE_FIELDS}`,
        [newName, req.user.id]
      );

      if (previous && previous !== newName) _tryUnlinkAvatar(previous);

      return res.json(rows[0]);
    } catch (err) {
      if (req.file) _tryUnlinkAvatar(req.file.filename);
      next(err);
    }
  },

  // PATCH /api/v1/users/me/password  { current_password, new_password }
  async changePassword(req, res, next) {
    try {
      const { current_password, new_password } = req.body;

      // Fetch current hash
      const { rows } = await dbQuery(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.user.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.user.userNotFound'), code: 404 });
      }

      const valid = await scrypt.verify(rows[0].password_hash, current_password);
      if (!valid) {
        return res.status(401).json({ error: t(req.locale, 'errors.user.wrongCurrentPassword'), code: 401 });
      }

      const newHash = await scrypt.hash(new_password);
      await dbQuery(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [newHash, req.user.id]
      );

      return res.json({ message: t(req.locale, 'errors.user.passwordUpdated') });
    } catch (err) { next(err); }
  },

  // GET /api/v1/users/me/sessions
  async getSessions(req, res, next) {
    try {
      const { rows } = await dbQuery(
        `SELECT id, created_at, ip_address, user_agent, expires_at
         FROM user_sessions
         WHERE user_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [req.user.id]
      );
      // Mark the current session
      const currentSessionId = req.session.id;
      const sessions = rows.map(s => ({ ...s, is_current: s.id === currentSessionId }));
      return res.json(sessions);
    } catch (err) { next(err); }
  },

  // DELETE /api/v1/users/me/sessions/:sessionId
  async revokeSession(req, res, next) {
    try {
      const { sessionId } = req.params;
      // Only allow revoking own sessions
      const { rowCount } = await dbQuery(
        'DELETE FROM user_sessions WHERE id = $1 AND user_id = $2',
        [sessionId, req.user.id]
      );
      if (rowCount === 0) {
        return res.status(404).json({ error: t(req.locale, 'errors.user.sessionNotFound'), code: 404 });
      }
      return res.status(204).send();
    } catch (err) { next(err); }
  },

  // DELETE /api/v1/users/me/sessions  — revoke all sessions except current
  async revokeAllSessions(req, res, next) {
    try {
      const currentSessionId = req.session.id;
      await dbQuery(
        'DELETE FROM user_sessions WHERE user_id = $1 AND id != $2',
        [req.user.id, currentSessionId]
      );
      return res.status(204).send();
    } catch (err) { next(err); }
  },
};

module.exports = userController;
