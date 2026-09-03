// Soft auth — populate req.user/req.session if a valid session cookie is
// present, but never reject when it's missing. Used by routes that work for
// both signed-in and anonymous visitors (guest checkout, test-env change
// requests). Contrast with auth/middleware.js `requireAuth`, which 401s.
const { lucia } = require('../auth/lucia');
const UserRole  = require('../models/UserRole');

async function softAuth(req, res, next) {
  try {
    const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
    if (!sessionId) return next();
    const { session, user } = await lucia.validateSession(sessionId);
    if (session && user && !user.disabled) {
      req.user = user;
      req.session = session;
      // Same contract as requireAuth: req.user.roles is the authoritative set
      // for permission decisions (changeRequestGate reads it); users.role is
      // only the denormalized primary. Fall back to the primary on a read error.
      try {
        const roles = await UserRole.listForUser(user.id);
        req.user.roles = roles.length ? roles : [user.role];
      } catch {
        req.user.roles = [user.role];
      }
    }
    return next();
  } catch {
    return next();
  }
}

module.exports = { softAuth };
