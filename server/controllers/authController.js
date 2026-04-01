// Session-based auth using Lucia v3.
// Passwords hashed with oslo Scrypt (pure-Node, no native bindings needed).
// Account lockout: 5 failures → 15-min lock.
const crypto              = require('crypto');
const { query: dbQuery }  = require('../config/database');
const { lucia }           = require('../auth/lucia');
const { Scrypt }          = require('oslo/password');
const securityLogger      = require('../observability/securityLogger');
const { authLoginAttempts, authSignupTotal } = require('../observability/metrics');
const { trackFailedLogin } = require('../observability/alerts');

const scrypt = new Scrypt();

const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 minutes
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TTL_MS  =      60 * 60 * 1000; // 1 hour

/** Generate a cryptographically-random hex token (64 chars). */
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

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
                failed_login_attempts, locked_until,
                disabled, disabled_reason
         FROM users WHERE username = $1`,
        [username]
      );
      const user = rows[0] ?? null;

      // Check lockout before password work — a locked account already reveals
      // the username exists, so an early return is acceptable here.
      if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
        authLoginAttempts.inc({ result: 'locked' });
        securityLogger.loginFailed(req.ip, username);
        return res.status(401).json({ error: 'Account temporarily locked', code: 401 });
      }

      // Always perform hash work to prevent timing-based username enumeration.
      let validPass = false;
      if (user) {
        try {
          validPass = await scrypt.verify(user.password_hash, password);
        } catch { validPass = false; }
      } else {
        await scrypt.hash(password).catch(() => {});
      }

      if (!user || !validPass) {
        authLoginAttempts.inc({ result: 'failure' });
        securityLogger.loginFailed(req.ip, username);
        trackFailedLogin(req.ip);
        if (user) {
          const attempts = (user.failed_login_attempts || 0) + 1;
          if (attempts >= MAX_ATTEMPTS) {
            const lockedUntil = new Date(Date.now() + LOCKOUT_MS);
            await dbQuery(
              'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
              [attempts, lockedUntil, user.id]
            );
            securityLogger.accountLocked(req.ip, username, user.id);
          } else {
            await dbQuery(
              'UPDATE users SET failed_login_attempts = $1 WHERE id = $2',
              [attempts, user.id]
            );
          }
        }
        return res.status(401).json({ error: 'Invalid credentials', code: 401 });
      }

      // Block disabled accounts after credentials are confirmed valid
      if (user.disabled) {
        authLoginAttempts.inc({ result: 'failure' });
        securityLogger.disabledAccountAccess(user.id, username, req.ip);
        return res.status(403).json({ error: 'Account has been disabled', code: 403 });
      }

      // Successful login — reset counters, create session
      await dbQuery(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
        [user.id]
      );
      authLoginAttempts.inc({ result: 'success' });
      securityLogger.loginSuccess(req.ip, username, user.id);

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

  // POST /auth/signup  { username, email, password, phone?, display_name?, avatar? }
  // Validation (format + length) handled upstream by validateSignup middleware.
  async signup(req, res, next) {
    try {
      const { username, email, password, phone, display_name, avatar } = req.body;

      // Uniqueness checks
      const { rows: uRows } = await dbQuery(
        'SELECT id FROM users WHERE username = $1',
        [username]
      );
      if (uRows.length > 0) {
        authSignupTotal.inc({ result: 'failure' });
        return res.status(409).json({ error: 'Username already taken', code: 409 });
      }

      const { rows: eRows } = await dbQuery(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );
      if (eRows.length > 0) {
        authSignupTotal.inc({ result: 'failure' });
        return res.status(409).json({ error: 'Email already registered', code: 409 });
      }

      const passwordHash = await scrypt.hash(password);
      const verifyToken  = makeToken();
      const verifyExpiry = new Date(Date.now() + VERIFY_TTL_MS);
      const chosenAvatar = avatar ?? 'avatar-01.svg';

      const { rows } = await dbQuery(
        `INSERT INTO users
           (username, email, password_hash, role,
            display_name, phone, avatar,
            email_verify_token, email_verify_expires)
         VALUES ($1, $2, $3, 'user', $4, $5, $6, $7, $8)
         RETURNING id, username, email, role`,
        [
          username,
          email.toLowerCase(),
          passwordHash,
          display_name ?? null,
          phone ?? null,
          chosenAvatar,
          verifyToken,
          verifyExpiry,
        ]
      );

      // Log token — wire up a real email sender here when ready
      console.log(`[Auth] Email verification token for ${email}: ${verifyToken}`);

      authSignupTotal.inc({ result: 'success' });
      securityLogger.signupAttempt(req.ip, username, 'success');
      return res.status(201).json({
        message: 'Account created. Please verify your email.',
        user: rows[0],
      });
    } catch (err) { next(err); }
  },

  // POST /auth/verify-email  { token }
  async verifyEmail(req, res, next) {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'token is required', code: 400 });
      }

      const { rows } = await dbQuery(
        `SELECT id, email_verify_expires FROM users
         WHERE email_verify_token = $1 AND email_verified = FALSE`,
        [token]
      );

      if (rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or already-used verification token', code: 400 });
      }

      const user = rows[0];
      if (new Date(user.email_verify_expires) < new Date()) {
        return res.status(400).json({ error: 'Verification token has expired', code: 400 });
      }

      await dbQuery(
        `UPDATE users
         SET email_verified = TRUE,
             email_verify_token = NULL,
             email_verify_expires = NULL
         WHERE id = $1`,
        [user.id]
      );

      return res.json({ message: 'Email verified successfully.' });
    } catch (err) { next(err); }
  },

  // POST /auth/forgot-password  { email }
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: 'email is required', code: 400 });
      }

      const { rows } = await dbQuery(
        'SELECT id FROM users WHERE email = $1 AND disabled = FALSE',
        [email.toLowerCase()]
      );

      // Always return 200 to prevent email enumeration
      if (rows.length > 0) {
        const resetToken  = makeToken();
        const resetExpiry = new Date(Date.now() + RESET_TTL_MS);

        await dbQuery(
          'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
          [resetToken, resetExpiry, rows[0].id]
        );

        // Log token — wire up a real email sender here when ready
        console.log(`[Auth] Password reset token for ${email}: ${resetToken}`);
      }

      return res.json({ message: 'If that email is registered you will receive a reset link.' });
    } catch (err) { next(err); }
  },

  // POST /auth/reset-password  { token, password }
  async resetPassword(req, res, next) {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ error: 'token and password are required', code: 400 });
      }

      const { rows } = await dbQuery(
        `SELECT id, password_reset_expires FROM users
         WHERE password_reset_token = $1`,
        [token]
      );

      if (rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or already-used reset token', code: 400 });
      }

      const user = rows[0];
      if (new Date(user.password_reset_expires) < new Date()) {
        return res.status(400).json({ error: 'Reset token has expired', code: 400 });
      }

      const newHash = await scrypt.hash(password);

      await dbQuery(
        `UPDATE users
         SET password_hash = $1,
             password_reset_token = NULL,
             password_reset_expires = NULL,
             failed_login_attempts = 0,
             locked_until = NULL
         WHERE id = $2`,
        [newHash, user.id]
      );

      // Invalidate all existing sessions for security
      await lucia.invalidateUserSessions(user.id);

      return res.json({ message: 'Password updated. Please log in with your new password.' });
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

  // GET /auth/session — returns current session/user info
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
          id:             user.id,
          username:       user.username,
          email:          user.email,
          role:           user.role,
          avatar:         user.avatar,
          display_name:   user.display_name,
          phone:          user.phone,
          email_verified: user.email_verified,
        },
      });
    } catch (err) { next(err); }
  },

  // GET /auth/check-username/:username
  async checkUsername(req, res, next) {
    try {
      const { username } = req.params;
      const { rows } = await dbQuery(
        'SELECT id FROM users WHERE username = $1',
        [username]
      );
      return res.json({ available: rows.length === 0 });
    } catch (err) { next(err); }
  },

  // GET /auth/check-email/:email
  async checkEmail(req, res, next) {
    try {
      const { email } = req.params;
      const { rows } = await dbQuery(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );
      return res.json({ available: rows.length === 0 });
    } catch (err) { next(err); }
  },
};

module.exports = authController;
