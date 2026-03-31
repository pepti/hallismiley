// OAuth 2.0-style auth flow using RS256 JWT — mirrors how Azure AD issues tokens
// Access token:  short-lived (15 min), signed with RSA private key
// Refresh token: long-lived (7 days),  stored hashed in DB for revocation support
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query: dbQuery, pool } = require('../config/database');
const { privateKey, publicKey } = require('../config/keys');

const ACCESS_TOKEN_TTL  = 15 * 60;           // 15 minutes (seconds)
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60;  // 7 days (seconds)

// Cookie options — httpOnly prevents JS access (mirrors Azure's secure cookie handling)
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   REFRESH_TOKEN_TTL * 1000,
  path:     '/auth/refresh',
};

function issueAccessToken(sub) {
  return jwt.sign(
    { sub, role: 'admin' },
    privateKey,
    { algorithm: 'RS256', expiresIn: ACCESS_TOKEN_TTL, issuer: 'halliprojects' }
  );
}

async function storeRefreshToken(rawToken, client) {
  const hash      = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);
  const runner    = client || { query: dbQuery };
  await runner.query(
    'INSERT INTO refresh_tokens (token_hash, expires_at) VALUES ($1, $2)',
    [hash, expiresAt]
  );
}

const authController = {
  // POST /auth/login  { username, password }
  async login(req, res, next) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'username and password are required', code: 400 });
      }

      // Validate against admin credentials stored in env
      const validUser = username === process.env.ADMIN_USERNAME;
      const validPass = validUser
        ? await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH)
        : false;

      // Constant-time-ish rejection — don't reveal which field was wrong
      if (!validUser || !validPass) {
        return res.status(401).json({ error: 'Invalid credentials', code: 401 });
      }

      const accessToken  = issueAccessToken(username);
      const refreshToken = crypto.randomBytes(64).toString('hex');
      await storeRefreshToken(refreshToken, null);

      res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTS);
      res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL });
    } catch (err) { next(err); }
  },

  // POST /auth/refresh  (refresh token arrives via httpOnly cookie)
  async refresh(req, res, next) {
    try {
      const rawToken = req.cookies?.refresh_token;
      if (!rawToken) return res.status(401).json({ error: 'No refresh token', code: 401 });

      const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const { rows } = await dbQuery(
        'SELECT id, token_hash, expires_at, revoked FROM refresh_tokens WHERE token_hash = $1',
        [hash]
      );

      const stored = rows[0];
      if (!stored || stored.revoked || new Date(stored.expires_at) < new Date()) {
        res.clearCookie('refresh_token', { path: '/auth/refresh' });
        return res.status(401).json({ error: 'Refresh token invalid or expired', code: 401 });
      }

      // Token rotation — revoke old + store new in a single transaction to prevent
      // a window where both tokens are simultaneously valid or both are gone.
      const newRefresh = crypto.randomBytes(64).toString('hex');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [stored.id]);
        await storeRefreshToken(newRefresh, client);
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      const accessToken = issueAccessToken(process.env.ADMIN_USERNAME);
      res.cookie('refresh_token', newRefresh, REFRESH_COOKIE_OPTS);
      res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL });
    } catch (err) { next(err); }
  },

  // POST /auth/logout
  async logout(req, res, next) {
    try {
      const rawToken = req.cookies?.refresh_token;
      if (rawToken) {
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        await dbQuery('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [hash]);
      }
      res.clearCookie('refresh_token', { path: '/auth/refresh' });
      res.status(204).send();
    } catch (err) { next(err); }
  },
};

module.exports = authController;
