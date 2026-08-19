// Session-based auth using Lucia v3.
// Passwords hashed with oslo Scrypt (pure-Node, no native bindings needed).
// Account lockout: 5 failures → 15-min lock.
const { query: dbQuery } = require('../config/database');
const { lucia }           = require('../auth/lucia');
const { makeToken, hashToken } = require('../auth/tokens');
const Role                = require('../models/Role');
const UserRole            = require('../models/UserRole');
const { Scrypt }          = require('oslo/password');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const securityLogger      = require('../observability/securityLogger');
const { trackFailedLogin } = require('../observability/alerts');
const mfaService          = require('../services/mfaService');
const { t }               = require('../i18n');

const scrypt = new Scrypt();

const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 minutes
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TTL_MS  =      60 * 60 * 1000; // 1 hour

// Multi-role identity fields for a session payload: the denormalized primary role,
// the full role SET (user_roles), and the UNION of admin views across that set.
// Floors to the primary if the set is somehow empty, so the client always gets a
// coherent role list.
async function roleFields(userId, primaryRole) {
  const roles = await UserRole.listForUser(userId);
  const set   = roles.length ? roles : [primaryRole];
  return { role: primaryRole, roles: set, views: await Role.getViewsForRoles(set) };
}

const authController = {
  // POST /auth/login  { username, password }
  async login(req, res, next) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.usernamePasswordRequired'), code: 400 });
      }

      // Accept either a username or an email in the same field. The login
      // modal labels this "Email or username" — we look up case-insensitively
      // against both columns so users don't have to remember which they used.
      // UNIQUE indexes on username and email guarantee at most one row matches.
      const { rows } = await dbQuery(
        `SELECT id, username, email, role, password_hash,
                failed_login_attempts, locked_until,
                disabled, disabled_reason,
                avatar, display_name, phone, totp_enabled,
                email_verified, party_access, approval_status
         FROM users
         WHERE LOWER(username) = LOWER($1)
            OR LOWER(email)    = LOWER($1)
         LIMIT 1`,
        [username]
      );
      const user = rows[0] ?? null;

      // Check lockout before password work — a locked account already reveals
      // the username exists, so an early return is acceptable here.
      if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(401).json({ error: t(req.locale, 'errors.auth.accountLocked'), code: 401 });
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
          securityLogger.loginFailed(req.ip, username);
          trackFailedLogin(req.ip);
        } else {
          securityLogger.loginFailed(req.ip, username);
        }
        return res.status(401).json({ error: t(req.locale, 'errors.auth.invalidCredentials'), code: 401 });
      }

      // Block disabled accounts after credentials are confirmed valid
      if (user.disabled) {
        return res.status(403).json({ error: t(req.locale, 'errors.auth.accountDisabled'), code: 403 });
      }

      // Block party guests who haven't been approved yet. approval_status
      // defaults to 'approved', so existing users and the normal signup flow
      // pass straight through — only pending/declined party requests are gated.
      if (user.approval_status === 'pending') {
        return res.status(403).json({ error: t(req.locale, 'errors.party.approvalPending'), code: 403 });
      }
      if (user.approval_status === 'declined') {
        return res.status(403).json({ error: t(req.locale, 'errors.party.requestDeclined'), code: 403 });
      }

      // Password accepted — clear the brute-force counters either way.
      await dbQuery(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
        [user.id]
      );

      // Second factor. NO session is created here: a half-authenticated session
      // is still a session, and anything that forgot to check an "upgraded" flag
      // would be a bypass. The challenge id is not a credential for anything
      // except exchanging a correct code for a real session.
      if (mfaService.isProtected(user)) {
        const challengeId = await mfaService.createChallenge(user.id, {
          ip: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        });
        securityLogger.loginSuccess(req.ip, `${user.username} (password ok, awaiting 2FA)`, user.id);
        return res.json({
          mfaRequired: true,
          challengeId,
          expiresInMs: mfaService.CHALLENGE_TTL_MS,
        });
      }

      const session = await lucia.createSession(user.id, {
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
      });
      res.setHeader('Set-Cookie', lucia.createSessionCookie(session.id).serialize());

      securityLogger.loginSuccess(req.ip, user.username, user.id);

      return res.json({
        user: {
          id:             user.id,
          username:       user.username,
          email:          user.email,
          ...(await roleFields(user.id, user.role)),
          avatar:         user.avatar,
          display_name:   user.display_name,
          phone:          user.phone,
          email_verified: user.email_verified,
          party_access:   user.party_access,
          approval_status: user.approval_status,
        },
      });
    } catch (err) { next(err); }
  },

  // POST /auth/login/totp  { challengeId, code }
  //
  // Step two of a protected sign-in. The challenge proves the password step
  // already succeeded, so this endpoint never sees or re-checks a password —
  // which is also why it must be rate-limited as tightly as /login itself.
  //
  // `code` is either a 6-digit TOTP or a single-use recovery code; mfaService
  // decides which, so the user does not have to tell us.
  async loginTotp(req, res, next) {
    try {
      const { challengeId, code } = req.body;
      if (!challengeId || !code) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.mfaCodeRequired'), code: 400 });
      }

      const result = await mfaService.verifyChallenge(challengeId, code);
      if (!result.ok) {
        // Deliberately uniform: a wrong code, an expired challenge and a spent
        // challenge all look the same to the caller apart from the message, and
        // none of them says whether the account exists or has 2FA.
        const messages = {
          EXPIRED:           'errors.auth.mfaChallengeExpired',
          TOO_MANY_ATTEMPTS: 'errors.auth.mfaTooManyAttempts',
          INVALID:           'errors.auth.mfaChallengeInvalid',
          BAD_CODE:          'errors.auth.mfaBadCode',
        };
        securityLogger.loginFailed(req.ip, `2FA ${result.reason}`);
        return res.status(401).json({
          error: t(req.locale, messages[result.reason] || messages.BAD_CODE),
          code: 401,
          ...(typeof result.attemptsRemaining === 'number' ? { attemptsRemaining: result.attemptsRemaining } : {}),
        });
      }

      const { rows } = await dbQuery(
        `SELECT id, username, email, role, avatar, display_name, phone, disabled,
                email_verified, party_access, approval_status
           FROM users
          WHERE id = $1`,
        [result.userId]
      );
      const user = rows[0];
      // The account could have been disabled between the two steps.
      if (!user || user.disabled) {
        return res.status(403).json({ error: t(req.locale, 'errors.auth.accountDisabled'), code: 403 });
      }

      const session = await lucia.createSession(user.id, {
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
      });
      res.setHeader('Set-Cookie', lucia.createSessionCookie(session.id).serialize());

      securityLogger.loginSuccess(req.ip, user.username, user.id);

      const recoveryCodesRemaining = await mfaService.remainingRecoveryCodes(user.id);

      return res.json({
        // Surfaced so the UI can warn when the fallbacks are nearly gone — the
        // moment that matters for a single-admin site is *before* the last
        // one is spent, not after.
        usedRecoveryCode: result.usedRecoveryCode,
        recoveryCodesRemaining,
        user: {
          id:             user.id,
          username:       user.username,
          email:          user.email,
          ...(await roleFields(user.id, user.role)),
          avatar:         user.avatar,
          display_name:   user.display_name,
          phone:          user.phone,
          email_verified: user.email_verified,
          party_access:   user.party_access,
          approval_status: user.approval_status,
        },
      });
    } catch (err) { next(err); }
  },

  // POST /auth/totp/setup — begin enrolment, return the otpauth URI + manual key.
  //
  // Restricted to roles the login path actually challenges. Letting anyone enrol
  // would create accounts holding a secret that never gates anything — a
  // confusing state that looks like protection and isn't.
  async totpSetup(req, res, next) {
    try {
      const user = req.user;
      if (user.role !== 'admin') {
        return res.status(403).json({ error: t(req.locale, 'errors.auth.forbidden'), code: 403 });
      }
      if (user.totp_enabled) {
        return res.status(409).json({ error: t(req.locale, 'errors.auth.mfaAlreadyEnabled'), code: 409 });
      }

      const { secret, uri, qr } = await mfaService.beginEnrolment(user.id, user.email || user.username);
      securityLogger.loginSuccess(req.ip, `${user.username} started 2FA enrolment`, user.id);
      // Returned exactly once per setup call: the QR to scan, and the same
      // secret in text for manual entry when scanning isn't possible. Neither is
      // readable afterwards through any endpoint.
      return res.json({ secret, uri, qr });
    } catch (err) { next(err); }
  },

  // POST /auth/totp/confirm  { code } — prove the app works, switch 2FA on.
  async totpConfirm(req, res, next) {
    try {
      const user = req.user;
      if (user.role !== 'admin') {
        return res.status(403).json({ error: t(req.locale, 'errors.auth.forbidden'), code: 403 });
      }
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.mfaCodeRequired'), code: 400 });
      }

      const result = await mfaService.confirmEnrolment(user.id, code);
      if (!result.ok) {
        const map = {
          NOT_STARTED:     ['errors.auth.mfaNotStarted', 409],
          ALREADY_ENABLED: ['errors.auth.mfaAlreadyEnabled', 409],
          BAD_CODE:        ['errors.auth.mfaBadCode', 400],
        };
        const [key, status] = map[result.reason] || map.BAD_CODE;
        return res.status(status).json({ error: t(req.locale, key), code: status });
      }

      securityLogger.loginSuccess(req.ip, `${user.username} enabled 2FA`, user.id);
      // Shown once, never again — they are stored hashed.
      return res.json({ enabled: true, recoveryCodes: result.recoveryCodes });
    } catch (err) { next(err); }
  },

  // POST /auth/totp/disable  { password } — turn 2FA off.
  //
  // Requires the password again: a walk-up attacker with an unlocked laptop and a
  // live session should not be able to strip the second factor off the account.
  async totpDisable(req, res, next) {
    try {
      const user = req.user;
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.usernamePasswordRequired'), code: 400 });
      }

      const { rows } = await dbQuery('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      let validPass = false;
      try { validPass = await scrypt.verify(rows[0]?.password_hash || '', password); } catch { validPass = false; }
      if (!validPass) {
        securityLogger.loginFailed(req.ip, `${user.username} failed password check disabling 2FA`);
        return res.status(401).json({ error: t(req.locale, 'errors.auth.invalidCredentials'), code: 401 });
      }

      await mfaService.disable(user.id);
      securityLogger.loginSuccess(req.ip, `${user.username} DISABLED 2FA`, user.id);
      return res.json({ enabled: false });
    } catch (err) { next(err); }
  },

  // POST /auth/party-magic-login  { token }
  // Consumes a guest's non-expiring magic-login token and mints a Lucia session.
  // The token is stored hashed, so we look it up by its sha256. Clicking the link
  // proves control of the inbox, so we also confirm email verification + grant
  // access here. The token is NOT cleared — it's reusable by design (the owner
  // chose permanent links). CSRF-exempt because it mints a session, exactly like
  // login/signup (see middleware/csrf.js). Revoke by nulling the hash.
  async partyMagicLogin(req, res, next) {
    try {
      const { token } = req.body;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.tokenRequired'), code: 400 });
      }

      const { rows } = await dbQuery(
        `SELECT id, username, email, role, avatar, display_name, phone,
                disabled, approval_status
         FROM users
         WHERE magic_login_token_hash = $1
         LIMIT 1`,
        [hashToken(token)]
      );
      const user = rows[0] ?? null;

      if (!user) {
        return res.status(400).json({ error: t(req.locale, 'errors.party.invalidMagicLink'), code: 400 });
      }
      if (user.disabled) {
        return res.status(403).json({ error: t(req.locale, 'errors.auth.accountDisabled'), code: 403 });
      }
      if (user.approval_status === 'declined') {
        return res.status(403).json({ error: t(req.locale, 'errors.party.requestDeclined'), code: 403 });
      }

      await dbQuery(
        `UPDATE users
            SET email_verified        = TRUE,
                approval_status       = 'approved',
                party_access          = TRUE,
                failed_login_attempts = 0,
                locked_until          = NULL,
                last_login_at         = NOW()
          WHERE id = $1`,
        [user.id]
      );

      const session = await lucia.createSession(user.id, {
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
      });
      res.setHeader('Set-Cookie', lucia.createSessionCookie(session.id).serialize());

      securityLogger.loginSuccess(req.ip, user.username, user.id);

      return res.json({
        user: {
          id:              user.id,
          username:        user.username,
          email:           user.email,
          ...(await roleFields(user.id, user.role)),
          avatar:          user.avatar,
          display_name:    user.display_name,
          phone:           user.phone,
          email_verified:  true,
          party_access:    true,
          approval_status: 'approved',
        },
      });
    } catch (err) { next(err); }
  },

  // POST /auth/signup  { username, email, password, phone?, display_name?, avatar? }
  // Validation (format + length) handled upstream by validateSignup middleware.
  // Creates the account, logs the user in via a session cookie, and sends an
  // optional verification email. Verification is never required to use the site.
  async signup(req, res, next) {
    try {
      const { username, email, password, phone, display_name, avatar } = req.body;

      // Uniqueness checks
      securityLogger.signupAttempt(req.ip, username, 'started');

      const { rows: uRows } = await dbQuery(
        'SELECT id FROM users WHERE username = $1',
        [username]
      );
      if (uRows.length > 0) {
        return res.status(409).json({ error: t(req.locale, 'errors.auth.usernameTaken'), code: 409 });
      }

      const { rows: eRows } = await dbQuery(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );
      if (eRows.length > 0) {
        return res.status(409).json({ error: t(req.locale, 'errors.auth.emailRegistered'), code: 409 });
      }

      const passwordHash = await scrypt.hash(password);
      const chosenAvatar = avatar ?? 'avatar-01.svg';
      const verifyToken  = makeToken();
      const verifyExpiry = new Date(Date.now() + VERIFY_TTL_MS);

      const { rows } = await dbQuery(
        `INSERT INTO users
           (username, email, password_hash, role,
            display_name, phone, avatar,
            email_verified,
            email_verify_token, email_verify_expires)
         VALUES ($1, $2, $3, 'user', $4, $5, $6, FALSE, $7, $8)
         RETURNING id, username, email, role, avatar, display_name, phone,
                   email_verified, party_access, approval_status`,
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
      const newUser = rows[0];

      // Fire-and-log the verification email. Verification is optional, so a
      // delivery failure must not block signup — the resend flow covers retries.
      try {
        await sendVerificationEmail(email.toLowerCase(), verifyToken, req.locale);
      } catch (emailErr) {
        console.error('[signup] Verification email failed:', emailErr.message);
      }

      // Log the new user in immediately — no extra round-trip through /login.
      const session = await lucia.createSession(newUser.id, {
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
      });
      res.setHeader('Set-Cookie', lucia.createSessionCookie(session.id).serialize());

      return res.status(201).json({
        message: t(req.locale, 'errors.auth.accountCreated'),
        user: {
          id:             newUser.id,
          username:       newUser.username,
          email:          newUser.email,
          ...(await roleFields(newUser.id, newUser.role)),
          avatar:         newUser.avatar,
          display_name:   newUser.display_name,
          phone:          newUser.phone,
          email_verified: newUser.email_verified,
          party_access:   newUser.party_access,
          approval_status: newUser.approval_status,
        },
      });
    } catch (err) { next(err); }
  },

  // POST /auth/verify-email  { token }
  async verifyEmail(req, res, next) {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.tokenRequired'), code: 400 });
      }

      const { rows } = await dbQuery(
        `SELECT id, email_verify_expires FROM users
         WHERE email_verify_token = $1 AND email_verified = FALSE`,
        [token]
      );

      if (rows.length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.invalidVerifyToken'), code: 400 });
      }

      const user = rows[0];
      if (new Date(user.email_verify_expires) < new Date()) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.verifyTokenExpired'), code: 400 });
      }

      await dbQuery(
        `UPDATE users
         SET email_verified = TRUE,
             email_verify_token = NULL,
             email_verify_expires = NULL
         WHERE id = $1`,
        [user.id]
      );

      return res.json({ message: t(req.locale, 'errors.auth.emailVerified') });
    } catch (err) { next(err); }
  },

  // POST /auth/forgot-password  { email }
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.emailRequired'), code: 400 });
      }

      const { rows } = await dbQuery(
        'SELECT id, preferred_locale FROM users WHERE email = $1 AND disabled = FALSE',
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

        try {
          await sendPasswordResetEmail(email.toLowerCase(), resetToken, rows[0].preferred_locale || req.locale);
        } catch (emailErr) {
          console.error('[forgot-password] Email failed:', emailErr.message);
        }
      }

      return res.json({ message: t(req.locale, 'errors.auth.forgotPasswordSent') });
    } catch (err) { next(err); }
  },

  // POST /auth/reset-password  { token, password }
  async resetPassword(req, res, next) {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.tokenPasswordRequired'), code: 400 });
      }

      const { rows } = await dbQuery(
        `SELECT id, password_reset_expires FROM users
         WHERE password_reset_token = $1`,
        [token]
      );

      if (rows.length === 0) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.invalidResetToken'), code: 400 });
      }

      const user = rows[0];
      if (new Date(user.password_reset_expires) < new Date()) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.resetTokenExpired'), code: 400 });
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

      return res.json({ message: t(req.locale, 'errors.auth.passwordUpdatedReLogin') });
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
      // Session state must never be cached: a stale "authenticated" response
      // would let the SPA paint admin chrome after the session is gone (e.g. the
      // browser closed on a computer restart), then every API call 401s.
      res.setHeader('Cache-Control', 'no-store');
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
          ...(await roleFields(user.id, user.role)),
          avatar:         user.avatar,
          display_name:   user.display_name,
          phone:          user.phone,
          email_verified: user.email_verified,
          party_access:   user.party_access,
          approval_status: user.approval_status,
          // The ProfileView 2FA section paints from this flag; without it a
          // page reload forgets the account is protected and offers "Set up"
          // to an already-enrolled admin (which then 409s). NOTE: deliberately
          // included here where the icelandicstore original omits it — flagged
          // for back-porting there.
          totp_enabled:   !!user.totp_enabled,
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

  // POST /auth/resend-verification  { email }
  // Rate-limited to 1 per minute per email (enforced in the route layer).
  async resendVerification(req, res, next) {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: t(req.locale, 'errors.auth.emailRequired'), code: 400 });
      }

      const { rows } = await dbQuery(
        `SELECT id, email_verified, email_verify_token, email_verify_expires
         FROM users WHERE email = $1 AND disabled = FALSE`,
        [email.toLowerCase()]
      );

      // Always return 200 to prevent email enumeration
      if (rows.length === 0 || rows[0].email_verified) {
        return res.json({ message: t(req.locale, 'errors.auth.resendVerificationSent') });
      }

      const newToken  = makeToken();
      const newExpiry = new Date(Date.now() + VERIFY_TTL_MS);

      await dbQuery(
        `UPDATE users SET email_verify_token = $1, email_verify_expires = $2 WHERE id = $3`,
        [newToken, newExpiry, rows[0].id]
      );

      try {
        await sendVerificationEmail(email.toLowerCase(), newToken, req.locale);
      } catch (emailErr) {
        console.error('[resend-verification] Email failed:', emailErr.message);
      }

      return res.json({ message: t(req.locale, 'errors.auth.resendVerificationSent') });
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
