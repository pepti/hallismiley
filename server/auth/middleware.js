// Session validation middleware — reads auth_session cookie, validates via Lucia,
// attaches req.user and req.session, extends fresh sessions automatically.
const { lucia } = require('./lucia');
// Lucia's validateSession + the time-limited-login rule (migration 114): an
// expired user comes back as "no session" and their sessions are deleted.
const { validateSession, AccountExpiredError } = require('./accountExpiry');
const { resolveLocale } = require('../middleware/locale');
const UserRole = require('../models/UserRole');
const logger   = require('../logger');
const { applyMfaPolicyToRequest } = require('./mfaPolicy');

// Resolve the user's full role SET (cached, models/UserRole.js) and attach it
// as req.user.roles — the authoritative set for permission decisions; users.role
// stays the denormalized primary. One copy of this, shared by requireAuth,
// optionalAuth and middleware/softAuth.js: it used to be pasted into each.
//
// On a read error, fall back to the primary alone so auth never breaks on a
// transient user_roles failure — and log it, because for an admin granted only
// through the role set that fallback is a silent demotion for this request,
// indistinguishable downstream from a deliberate deny.
//
// Then the two-factor policy: a protected account that has not enrolled a
// second factor is not that yet — `admin` is withheld from role + roles HERE,
// so every guard and every inline role check downstream refuses without having
// to know the rule (auth/mfaPolicy.js). Because every session reader goes
// through attachRoles, this is the one place the rule is applied.
async function attachRoles(req, user) {
  try {
    const roles = await UserRole.listForUser(user.id);
    req.user.roles = roles.length ? roles : [user.role];
  } catch (err) {
    logger.warn({ err: err.message, userId: user.id }, 'role set lookup failed; falling back to users.role for this request');
    req.user.roles = [user.role];
  }
  await applyMfaPolicyToRequest(req);
}

async function requireAuth(req, res, next) {
  // Already validated earlier in THIS request (the outer /api/v1/admin door in
  // app.js runs it before each admin router's own requireAuth): the session,
  // disabled and role checks have all been made, so don't make them twice.
  if (req._authValidated) return next();
  const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');

  if (!sessionId) {
    return res.status(401).json({ error: 'Unauthorized', code: 401 });
  }

  const { session, user, expired } = await validateSession(sessionId);

  if (!session) {
    const blank = lucia.createBlankSessionCookie();
    res.setHeader('Set-Cookie', blank.serialize());
    // A time-limited login that ran out mid-session: signed out (401), with
    // the stable reason so the SPA can say why instead of "session expired".
    if (expired) return next(new AccountExpiredError({ status: 401 }));
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

  await attachRoles(req, user);
  req._authValidated = true;

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

    const { session, user } = await validateSession(sessionId);
    if (!session || user.disabled) return next();

    if (session.fresh) {
      const refreshed = lucia.createSessionCookie(session.id);
      res.setHeader('Set-Cookie', refreshed.serialize());
    }

    req.user    = user;
    req.session = session;
    await attachRoles(req, user);
    req.locale = resolveLocale(req);
  } catch { /* treat any validation error as anonymous */ }
  next();
}

module.exports = { requireAuth, optionalAuth, attachRoles };
