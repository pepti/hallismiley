// User profile management — self-service endpoints for authenticated users.
const fs   = require('fs');
const path = require('path');
const { query: dbQuery } = require('../config/database');
const { Scrypt }         = require('oslo/password');
const { userAvatarDir }  = require('../config/paths');
const { t }              = require('../i18n');

const scrypt = new Scrypt();

const PROFILE_FIELDS = 'id, username, email, role, avatar, display_name, phone, email_verified, preferred_locale, theme, page_widths, page_width_motion, aside_widths, cookie_consent, created_at';
const { SUPPORTED_LOCALES } = require('../config/i18n');
const { THEMES }            = require('../config/themes');

// Page widths (setPageWidth; harvested from icelandicstore, migration 111).
// Keep the value list in step with public/js/services/pageWidth.js WIDTHS.
const PAGE_WIDTHS         = ['normal', 'wide', 'full'];
const PAGE_WIDTH_KEY_RE   = /^\/admin(\/[a-z0-9:-]+)*$/;
const PAGE_WIDTH_KEY_MAX  = 120;
const PAGE_WIDTH_MAX_KEYS = 100;
// The all-admin-pages width (Síðubreidd → Nota á allar síður). Not a path, so it
// can never collide with a page key. Keep in step with pageWidth.js ALL_KEY.
const PAGE_WIDTH_ALL_KEY  = '*';
// Right-column widths on the admin detail pages (setAsideWidth). Keep in step
// with public/js/services/pageWidth.js ASIDE_WIDTHS. Same keys, same '*'.
const ASIDE_WIDTHS        = ['narrow', 'medium', 'wide'];

// PUT handler for a per-page width map on users (`column` is a trusted
// constant, never request input). `path` is the SPA's page key
// (public/js/services/pageWidth.js pageWidthKey — locale stripped, id segments
// folded to ':id'); `width` null resets that page to its own default. One
// atomic UPDATE, so two quick picks cannot lose each other's keys the way a
// read-modify-write of the whole map would.
//
// `path` '*' is the all-pages width. Saving it REPLACES the map, so a page
// that had its own choice follows the new width too; a later per-page pick
// still overrides it. null clears only '*', and every page goes back to its
// own default.
function widthMapSetter(column, values, invalidWidthKey) {
  return async function setWidth(req, res, next) {
    try {
      const { path: key, width } = req.body || {};
      const isAll = key === PAGE_WIDTH_ALL_KEY;
      if (!isAll && (typeof key !== 'string' || key.length > PAGE_WIDTH_KEY_MAX || !PAGE_WIDTH_KEY_RE.test(key))) {
        return res.status(400).json({ error: t(req.locale, 'errors.user.invalidPageWidthPath'), code: 400 });
      }
      if (width !== null && !values.includes(width)) {
        return res.status(400).json({ error: t(req.locale, invalidWidthKey), code: 400 });
      }

      const { rows } = (isAll && width !== null)
        ? await dbQuery(
          `UPDATE users SET ${column} = jsonb_build_object($2::text, $3::text) WHERE id = $1 RETURNING ${column}`,
          [req.user.id, key, width])
        : width === null
        ? await dbQuery(
          `UPDATE users SET ${column} = ${column} - $2 WHERE id = $1 RETURNING ${column}`,
          [req.user.id, key])
        // A new key is refused once the map is full; overwriting an existing key
        // always succeeds. rowCount 0 then means "full", not "no such user".
        : await dbQuery(
          `UPDATE users SET ${column} = ${column} || jsonb_build_object($2::text, $3::text)
            WHERE id = $1
              AND (${column} ? $2 OR (SELECT count(*) FROM jsonb_object_keys(${column})) < $4)
            RETURNING ${column}`,
          [req.user.id, key, width, PAGE_WIDTH_MAX_KEYS]);

      if (!rows.length) {
        return res.status(400).json({ error: t(req.locale, 'errors.user.tooManyPageWidths'), code: 400 });
      }
      return res.json({ [column]: rows[0][column] });
    } catch (err) { next(err); }
  };
}

// Only delete a file that matches the user-upload pattern AND belongs to the
// caller — never the baked SVGs, and never another user's upload (the avatars
// dir is one flat shared directory). Shared with the avatar-field validator so
// the two allowlists can't drift apart again.
const { isOwnUploadedAvatar } = require('../middleware/validate');
function _tryUnlinkAvatar(filename, userId) {
  if (!isOwnUploadedAvatar(filename, userId)) return;
  try { fs.unlinkSync(path.join(userAvatarDir(), filename)); } catch { /* ignore */ }
}

const userController = {
  // PUT /api/v1/users/me/page-width  { path, width }
  // Per-user, per-page admin width (sidebar width icon → Síðubreidd); the
  // contract is widthMapSetter above.
  setPageWidth: widthMapSetter('page_widths', PAGE_WIDTHS, 'errors.user.invalidPageWidth'),

  // PUT /api/v1/users/me/aside-width  { path, width }
  // The right-hand column on the admin detail pages (components/AsideWidthControl.js):
  // 'narrow' | 'medium' | 'wide'. Same contract as setPageWidth, own column.
  setAsideWidth: widthMapSetter('aside_widths', ASIDE_WIDTHS, 'errors.user.invalidAsideWidth'),

  // PUT /api/v1/users/me/page-width-motion  { on }
  // Whether the admin shell slides to a new width (Mjúk hreyfing). A boolean,
  // nothing else; its own column, so the all-pages width (which replaces
  // page_widths) can never reset it.
  async setPageWidthMotion(req, res, next) {
    try {
      const { on } = req.body || {};
      if (typeof on !== 'boolean') {
        return res.status(400).json({ error: t(req.locale, 'errors.user.invalidPageWidthMotion'), code: 400 });
      }
      const { rows } = await dbQuery(
        'UPDATE users SET page_width_motion = $2 WHERE id = $1 RETURNING page_width_motion',
        [req.user.id, on]);
      return res.json({ page_width_motion: rows[0].page_width_motion });
    } catch (err) { next(err); }
  },

  // PUT /api/v1/users/me/cookie-consent  { value }
  // The analytics-cookie choice, saved on the account so the banner does not ask
  // a signed-in user again in another browser. 'accepted' | 'declined'.
  async setCookieConsent(req, res, next) {
    try {
      const { value } = req.body || {};
      if (value !== 'accepted' && value !== 'declined') {
        return res.status(400).json({ error: t(req.locale, 'errors.user.invalidCookieConsent'), code: 400 });
      }
      const { rows } = await dbQuery(
        'UPDATE users SET cookie_consent = $2 WHERE id = $1 RETURNING cookie_consent',
        [req.user.id, value]);
      return res.json({ cookie_consent: rows[0].cookie_consent });
    } catch (err) { next(err); }
  },
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
      const allowed  = ['username', 'display_name', 'phone', 'avatar', 'preferred_locale', 'theme'];
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

      // Theme is validated here rather than left to the DB CHECK constraint so
      // an unknown value returns a typed 400 instead of a 500 from Postgres.
      if ('theme' in updates && !THEMES.includes(updates.theme)) {
        return res.status(400).json({ error: t(req.locale, 'errors.user.unsupportedTheme'), code: 400 });
      }

      // Switching avatar via PATCH (e.g. back to a baked SVG) must clean up a
      // superseded uploaded file, or it sits orphaned in UPLOAD_ROOT/avatars
      // forever — uploadAvatar only covers the upload path.
      let previousAvatar = null;
      if ('avatar' in updates) {
        const { rows: prevRows } = await dbQuery(
          'SELECT avatar FROM users WHERE id = $1',
          [req.user.id]
        );
        previousAvatar = prevRows[0]?.avatar || null;
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
        if (
          err.code === '23505' &&
          (err.constraint === 'users_username_lower_idx' || err.constraint === 'users_username_key')
        ) {
          return res.status(409).json({ error: t(req.locale, 'errors.auth.usernameTaken'), code: 409 });
        }
        throw err;
      }

      if (previousAvatar && previousAvatar !== rows[0].avatar) {
        _tryUnlinkAvatar(previousAvatar, req.user.id);
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

      if (previous && previous !== newName) _tryUnlinkAvatar(previous, req.user.id);

      return res.json(rows[0]);
    } catch (err) {
      if (req.file) _tryUnlinkAvatar(req.file.filename, req.user.id);
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
