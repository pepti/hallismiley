// Session-based auth using Lucia v3.
// Passwords hashed with oslo Scrypt (pure-Node, no native bindings needed).
// Account lockout: 5 failures → 15-min lock.
const { query: dbQuery }  = require('../config/database');
const { lucia }           = require('../auth/lucia');
const { Scrypt }          = require('oslo/password');

const scrypt = new Scrypt();

const MAX_ATTEMPTS      = 5;
const LOCKOUT_MS        = 15 * 60 * 1000; // 15 minutes

const authController = {
  // POST /auth/login  { username, password }
  async login(req, res, next) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'username and password are required', code: 400 });
      }

      const { rows } = await dbQuery(
        `SELECT id, username, email, role, password_hash,
                failed_login_attempts, locked_until
         FROM users WHERE username = $1`,
        [username]
      );
      const user = rows[0] ?? null;

      // Check lockout before password work — a locked account already reveals
      // the username exists, so an early return is acceptable here.
      if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(401).json({ error: 'Account temporarily locked', code: 401 });
      }

      // Always perform hash work to prevent timing-based username enumeration.
      // If no user was found, hash the password anyway (result discarded).
      let validPass = false;
      if (user) {
        try {
          validPass = await scrypt.verify(user.password_hash, password);
        } catch { validPass = false; }
      } else {
        // Simulate cost — result intentionally ignored
        await scrypt.hash(password).catch(() => {});
      }

      if (!user || !validPass) {
        // Increment failed attempts if the user exists
        if (user) {
          const attempts = (user.failed_login_attempts || 0) + 1;
          if (attempts >= MAX_ATTEMPTS) {
            const lockedUntil = new Date(Date.now() + LOCKOUT_MS);
            await dbQuery(
              'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
              [attempts, lockedUntil, user.id]
            );
          } else {
            await dbQuery(
              'UPDATE users SET failed_login_attempts = $1 WHERE id = $2',
              [attempts, user.id]
            );
          }
        }
        return res.status(401).json({ error: 'Invalid credentials', code: 401 });
      }

      // Successful login — reset counters, create session
      await dbQuery(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
        [user.id]
      );

      const session = await lucia.createSession(user.id, {
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
      });
      res.setHeader('Set-Cookie', lucia.createSessionCookie(session.id).serialize());

      return res.json({
        user: {
          id:       user.id,
          username: user.username,
          email:    user.email,
          role:     user.role,
        },
      });
    } catch (err) { next(err); }
  },

  // POST /auth/logout
  async logout(req, res, next) {
    try {
      const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
      if (sessionId) {
        await lucia.invalidateSession(sessionId);
      }
      res.setHeader('Set-Cookie', lucia.createBlankSessionCookie().serialize());
      return res.status(204).send();
    } catch (err) { next(err); }
  },

  // GET /auth/session — returns current session/user info (replaces refresh flow)
  async session(req, res, next) {
    try {
      const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
      if (!sessionId) {
        return res.json({ authenticated: false });
      }

      const { session, user } = await lucia.validateSession(sessionId);
      if (!session) {
        res.setHeader('Set-Cookie', lucia.createBlankSessionCookie().serialize());
        return res.json({ authenticated: false });
      }

      if (session.fresh) {
        res.setHeader('Set-Cookie', lucia.createSessionCookie(session.id).serialize());
      }

      return res.json({
        authenticated: true,
        user: {
          id:       user.id,
          username: user.username,
          email:    user.email,
          role:     user.role,
        },
      });
    } catch (err) { next(err); }
  },
};

module.exports = authController;
