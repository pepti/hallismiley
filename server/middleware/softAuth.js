// Soft auth — populate req.user/req.session if a valid session cookie is
// present, but never reject when it's missing. Used by routes that work for
// both signed-in and anonymous visitors (guest checkout, test-env change
// requests). Contrast with auth/middleware.js `requireAuth`, which 401s.
const { lucia } = require('../auth/lucia');

async function softAuth(req, res, next) {
  try {
    const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
    if (!sessionId) return next();
    const { session, user } = await lucia.validateSession(sessionId);
    if (session && user && !user.disabled) {
      req.user = user;
      req.session = session;
    }
    return next();
  } catch {
    return next();
  }
}

module.exports = { softAuth };
