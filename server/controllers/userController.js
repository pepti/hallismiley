// User profile management — self-service endpoints for authenticated users.
const { query: dbQuery } = require('../config/database');
const { Scrypt }         = require('oslo/password');

const scrypt = new Scrypt();

const PROFILE_FIELDS = [
  'id', 'username', 'email', 'role', 'avatar', 'display_name', 'phone',
  'email_verified', 'created_at',
  'bio', 'theme', 'notify_comments', 'notify_updates',
  'last_login_at', 'last_login_ip', 'last_login_ua',
  'github_username', 'linkedin_username',
].join(', ');

const PUBLIC_PROFILE_FIELDS = [
  'id', 'username', 'display_name', 'avatar', 'role', 'bio',
  'github_username', 'linkedin_username', 'created_at',
].join(', ');

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

  // PATCH /api/v1/users/me
  // Field validation handled upstream by validateProfileUpdate middleware.
  async updateMe(req, res, next) {
    try {
      const allowed = [
        'display_name', 'phone', 'avatar',
        'bio', 'theme', 'notify_comments', 'notify_updates',
        'github_username', 'linkedin_username',
      ];
      const updates = {};
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
      const currentSessionId = req.session.id;
      const sessions = rows.map(s => ({ ...s, is_current: s.id === currentSessionId }));
      return res.json(sessions);
    } catch (err) { next(err); }
  },

  // DELETE /api/v1/users/me/sessions/:sessionId
  async revokeSession(req, res, next) {
    try {
      const { sessionId } = req.params;
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

  // GET /api/v1/users/:username  — public profile (no auth required)
  async getPublicProfile(req, res, next) {
    try {
      const { username } = req.params;
      const { rows } = await dbQuery(
        `SELECT ${PUBLIC_PROFILE_FIELDS} FROM users WHERE username = $1 AND disabled = FALSE`,
        [username]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found', code: 404 });
      }
      const user = rows[0];

      // Fetch favorite projects
      const { rows: favRows } = await dbQuery(
        `SELECT p.id, p.title, p.category, p.year, p.image_url, p.featured
         FROM user_favorites uf
         JOIN projects p ON p.id = uf.project_id
         WHERE uf.user_id = $1
         ORDER BY uf.created_at DESC`,
        [user.id]
      );

      return res.json({ ...user, favorite_projects: favRows });
    } catch (err) { next(err); }
  },

  // GET /api/v1/users/me/favorites
  async getFavorites(req, res, next) {
    try {
      const { rows } = await dbQuery(
        `SELECT p.id, p.title, p.description, p.category, p.year, p.image_url, p.featured,
                uf.created_at AS favorited_at
         FROM user_favorites uf
         JOIN projects p ON p.id = uf.project_id
         WHERE uf.user_id = $1
         ORDER BY uf.created_at DESC`,
        [req.user.id]
      );
      return res.json(rows);
    } catch (err) { next(err); }
  },

  // POST /api/v1/users/me/favorites/:projectId
  async addFavorite(req, res, next) {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return res.status(400).json({ error: 'Invalid project id', code: 400 });
      }

      // Verify project exists
      const { rows: pRows } = await dbQuery(
        'SELECT id FROM projects WHERE id = $1',
        [projectId]
      );
      if (pRows.length === 0) {
        return res.status(404).json({ error: 'Project not found', code: 404 });
      }

      // Upsert — on duplicate just return 200
      const { rows } = await dbQuery(
        `INSERT INTO user_favorites (user_id, project_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, project_id) DO NOTHING
         RETURNING project_id, created_at`,
        [req.user.id, projectId]
      );

      if (rows.length === 0) {
        // Already favorited
        return res.status(200).json({ message: 'Already favorited' });
      }
      return res.status(201).json(rows[0]);
    } catch (err) { next(err); }
  },

  // DELETE /api/v1/users/me/favorites/:projectId
  async removeFavorite(req, res, next) {
    try {
      const projectId = parseInt(req.params.projectId, 10);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return res.status(400).json({ error: 'Invalid project id', code: 400 });
      }

      const { rowCount } = await dbQuery(
        'DELETE FROM user_favorites WHERE user_id = $1 AND project_id = $2',
        [req.user.id, projectId]
      );
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Favorite not found', code: 404 });
      }
      return res.status(204).send();
    } catch (err) { next(err); }
  },
};

module.exports = userController;
