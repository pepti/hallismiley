// CSRF protection using the double-submit cookie pattern (csrf-csrf v4).
// Applied to all state-changing routes except auth creation endpoints
// (login/signup/forgot-password/reset-password/verify-email).
//
// Frontend usage:
//   1. GET /api/v1/csrf-token  → receive { token }
//   2. Include as header  X-CSRF-Token: <token>  on every POST/PATCH/DELETE

const { doubleCsrf } = require('csrf-csrf');

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET ?? 'dev-csrf-secret-change-in-production',
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
