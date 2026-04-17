// CSRF protection using the double-submit cookie pattern (csrf-csrf v4).
// Applied to all state-changing routes except auth creation endpoints
// (login/signup/forgot-password/reset-password/verify-email).
//
// Frontend usage:
//   1. GET /api/v1/csrf-token  → receive { token }
//   2. Include as header  X-CSRF-Token: <token>  on every POST/PATCH/DELETE

const { doubleCsrf } = require('csrf-csrf');

// Fail-loud if CSRF_SECRET is unset in production. A hard-coded fallback would
// defeat the double-submit protection entirely for anyone with access to this
// repo, so production boot must abort rather than silently degrade.
const CSRF_SECRET = (() => {
  const fromEnv = process.env.CSRF_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CSRF_SECRET environment variable is required in production and must be at least 32 characters. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"'
    );
  }
  // Dev / test fallback — still a fixed string, but clearly labelled and only used outside production.
  return fromEnv || 'dev-csrf-secret-not-for-production-use-only';
})();

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  // Tie CSRF token to the current auth session so tokens can't be reused across sessions.
  getSessionIdentifier: (req) => {
    const cookie = req.headers.cookie ?? '';
    const match  = cookie.match(/auth_session=([^;]+)/);
    return match ? match[1] : (req.ip ?? 'anonymous');
  },
  cookieName:    'x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
  },
  getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
  size:            64,
  ignoredMethods:  ['GET', 'HEAD', 'OPTIONS'],
});

/**
 * Wraps doubleCsrfProtection with:
 *  - test-mode bypass (NODE_ENV === 'test')
 *  - clean 403 JSON instead of the default http-errors response
 */
function csrfProtect(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
  doubleCsrfProtection(req, res, (err) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid CSRF token', code: 403 });
    }
    next();
  });
}

module.exports = { generateCsrfToken, csrfProtect };
