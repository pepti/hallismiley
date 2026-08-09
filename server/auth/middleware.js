// Session validation middleware — reads auth_session cookie, validates via Lucia,
// attaches req.user and req.session, extends fresh sessions automatically.
const { lucia } = require('./lucia');
const { resolveLocale } = require('../middleware/locale');
const UserRole = require('../models/UserRole');

async function requireAuth(req, res, next) {
  const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');

  if (!sessionId) {
    return res.status(401).json({ error: 'Unauthorized', code: 401 });
  }

  const { session, user } = await lucia.validateSession(sessionId);

  if (!session) {
    const blank = lucia.createBlankSessionCookie();
    res.setHeader('Set-Cookie', blank.serialize());
    return res.status(401).json({ error: 'Unauthorized', code: 401 });
  }

  // Reject sessions belonging to disabled accounts
  if (user.disabled) {
    await lucia.invalidateSession(sessionId);
    const blank = lucia.createBlankSessionCookie();
    res.setHeader('Set-Cookie', blank.serialize());
    return res.status(403).json({ error: 'Account has been disabled', code: 403 });
  }

  // Extend expiry on active sessions (Lucia rotates cookie when session is "fresh")
  if (session.fresh) {
    const refreshed = lucia.createSessionCookie(session.id);
    res.setHeader('Set-Cookie', refreshed.serialize());
  }

  req.user    = user;
  req.session = session;

  // Multi-role: resolve the user's full role SET (cached) so requireRole /
  // requireView can union across it. users.role stays the denormalized "primary";
  // req.user.roles is the authoritative set for permission decisions. Fall back to
  // the primary alone if the lookup fails, so auth never breaks on a transient
  // user_roles read error.
  try {
    const roles = await UserRole.listForUser(user.id);
    req.user.roles = roles.length ? roles : [user.role];
  } catch {
    req.user.roles = [user.role];
  }

  // The global locale middleware ran before auth (req.user was undefined), so
  // the user's saved preferred_locale couldn't participate in resolution.
  // Re-resolve now that we know who's logged in — explicit per-request signals
  // (query/header/cookie) still win, so a user with preferred_locale='is' can
  // still browse /en/* without their saved preference overriding the URL.
  req.locale = resolveLocale(req);

  next();
}

// Best-effort variant for PUBLIC routes that still want attribution when a
// session happens to be present (e.g. the party album: anonymous visitors may
// upload, but a signed-in guest's upload should carry their user_id so they can
// delete it later). Never rejects — any missing/invalid/disabled session just
// leaves req.user undefined and the request proceeds anonymously.
async function optionalAuth(req, res, next) {
  try {
    const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');
    if (!sessionId) return next();

    const { session, user } = await lucia.validateSession(sessionId);
    if (!session || user.disabled) return next();

    if (session.fresh) {
      const refreshed = lucia.createSessionCookie(session.id);
      res.setHeader('Set-Cookie', refreshed.serialize());
    }

    req.user    = user;
    req.session = session;
    try {
      const roles = await UserRole.listForUser(user.id);
      req.user.roles = roles.length ? roles : [user.role];
    } catch {
      req.user.roles = [user.role];
    }
    req.locale = resolveLocale(req);
  } catch { /* treat any validation error as anonymous */ }
  next();
}

module.exports = { requireAuth, optionalAuth };
