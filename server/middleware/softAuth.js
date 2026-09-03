// Soft auth — populate req.user/req.session if a valid session cookie is
// present, but never reject when it's missing. Used by routes that work for
// both signed-in and anonymous visitors (guest checkout, test-stack change
// requests). Contrast with auth/middleware.js `requireAuth`, which 401s, and
// `optionalAuth`, which is this plus cookie rotation and locale resolution.
//
// Contract, shared with the auth middlewares through attachRoles: whenever
// req.user is set, req.user.roles is the authoritative role SET for permission
// decisions (changeRequestGate reads it); users.role is only the denormalized
// primary, and an admin granted through Admin → Roles never has it updated.
const { lucia } = require('../auth/lucia');
const { attachRoles } = require('../auth/middleware');

async function softAuth(req, res, next) {
  try {
    const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
    if (!sessionId) return next();
    const { session, user } = await lucia.validateSession(sessionId);
    if (session && user && !user.disabled) {
      req.user = user;
      req.session = session;
      await attachRoles(req, user);
    }
    return next();
  } catch {
    return next();
  }
}

module.exports = { softAuth };
