// User profile management — self-service endpoints for authenticated users.
const { query: dbQuery } = require('../config/database');
const { Scrypt }         = require('oslo/password');

const scrypt = new Scrypt();

const PROFILE_FIELDS = 'id, username, email, role, avatar, display_name, phone, email_verified, created_at';

const userController = {
  // GET /api/v1/users/me
  async getMe(req, res, next) {
    try {
      const { rows } = await dbQuery(
        `SELECT ${PROFILE_FIELDS} FROM users WHERE id = $1`,
        [req.user.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found', code: 404 });
      }
      return res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/users/me  { display_name?, phone?, avatar? }
  // Field validation handled upstream by validateProfileUpdate middleware.
  async updateMe(req, res, next) {
    try {
      const allowed  = ['display_name', 'phone', 'avatar'];
      const updates  = {};
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided', code: 400 });
      }

      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
      const values     = [req.user.id, ...Object.values(updates)];

      const { rows } = await dbQuery(
        `UPDATE users SET ${setClauses.join(', ')} WHERE id = $1
         RETURNING ${PROFILE_FIELDS}`,
        values
      );

      return res.json(rows[0]);
    } catch (err) { next(err); }
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
        return res.status(404).json({ error: 'User not found', code: 404 });
      }

      const valid = await scrypt.verify(rows[0].password_hash, current_password);
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect', code: 401 });
      }

      const newHash = await scrypt.hash(new_password);
      await dbQuery(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [newHash, req.user.id]
      );

      return res.json({ message: 'Password updated successfully.' });
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
        return res.status(404).json({ error: 'Session not found', code: 404 });
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
