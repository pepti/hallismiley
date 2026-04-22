// Session validation middleware — reads auth_session cookie, validates via Lucia,
// attaches req.user and req.session, extends fresh sessions automatically.
const { lucia } = require('./lucia');
const { SUPPORTED_LOCALES } = require('../config/i18n');

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

  // Locale middleware ran earlier (before auth) with req.user undefined, so it
  // could only consult request-level signals. Now that we know who's logged
  // in, the user's saved preferred_locale takes priority — override.
  if (user.preferred_locale && SUPPORTED_LOCALES.includes(user.preferred_locale)) {
    req.locale = user.preferred_locale;
  }

  next();
}

module.exports = { requireAuth };
