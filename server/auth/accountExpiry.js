// Time-limited logins (login-expiry-2026-09-26, roadmap R2b, D-020).
//
// `users.expires_at` (migration 114) is NULL for a login that never expires,
// or the moment it stops working. On the demo instance a seller makes a login
// for a prospect after a guided demo and gives it N days.
//
// Two halves, one predicate:
//   - every SIGN-IN path (password, the 2FA step, the magic link, Google,
//     Facebook, the MCP owner check) refuses an expired account — the JSON
//     paths throw AccountExpiredError into the central error handler, which
//     answers the envelope { error, code, reason: 'account_expired' }; the
//     OAuth redirects carry ?error=account_expired;
//   - every SESSION reader goes through validateSession() below, which treats
//     an expired user as signed out and deletes all their sessions. It costs
//     nothing extra on the hot path: Lucia's session join already selects
//     `users.*`, so expires_at rides on the user it loads (auth/lucia.js
//     getUserAttributes) — the only extra statement is the DELETE, once.
const { lucia } = require('./lucia');

const ACCOUNT_EXPIRED = 'account_expired';
const MESSAGE_KEY = 'errors.auth.accountExpired';

// How far ahead an admin may set an expiry. A time-limited login is a demo
// login; ten years is "never" said wrongly, and the cap stops a typo'd year
// 20260 from reading as a real date.
const MAX_AHEAD_MS = 10 * 366 * 24 * 60 * 60 * 1000;

/**
 * The typed refusal. `messageKey` is translated by the central error handler
 * for the request's locale; `reason` is the stable code clients branch on.
 * 403 on a sign-in (the credentials were right, the login is not allowed),
 * 401 when a live session dies (the client is signed out).
 */
class AccountExpiredError extends Error {
  constructor({ status = 403 } = {}) {
    super('This login has expired');
    this.name = 'AccountExpiredError';
    this.status = status;
    this.reason = ACCOUNT_EXPIRED;
    this.messageKey = MESSAGE_KEY;
  }
}

/**
 * An admin tried to time-limit an account that holds admin powers
 * (utils/adminRole.js userHoldsAdminPowers; security review Low-1): an expiry
 * is a delayed lockout, so it is never set on one. 409, reason
 * 'admin_account'.
 */
class ExpiryOnAdminError extends Error {
  constructor() {
    super('An administrator\'s login cannot be time-limited');
    this.name = 'ExpiryOnAdminError';
    this.status = 409;
    this.reason = 'admin_account';
    this.messageKey = 'errors.admin.cannotExpireAdmin';
  }
}

/** Has this user row's login expired? NULL/absent = never. Fails closed on a
 *  value that is not a date (it comes from a TIMESTAMPTZ, so it never is). */
function isExpired(user, now = Date.now()) {
  const at = user ? user.expires_at : null;
  if (at === null || at === undefined) return false;
  const ms = at instanceof Date ? at.getTime() : Date.parse(at);
  return !Number.isFinite(ms) || ms <= now;
}

/** Throw AccountExpiredError when the row's login has expired. */
function assertNotExpired(user) {
  if (isExpired(user)) throw new AccountExpiredError();
}

/**
 * Lucia's validateSession, plus the expiry rule: an expired user's sessions
 * are all deleted and the caller gets { session: null, user: null,
 * expired: true } — exactly what a dead session looks like, so every reader
 * that already handles "no session" handles this.
 */
async function validateSession(sessionId) {
  const { session, user } = await lucia.validateSession(sessionId);
  if (session && user && isExpired(user)) {
    await lucia.invalidateUserSessions(user.id);
    return { session: null, user: null, expired: true };
  }
  return { session, user, expired: false };
}

// A full ISO 8601 date-time with an EXPLICIT zone: seconds and a fraction
// optional, `Z` or ±hh:mm required, nothing after it (security review Info-5:
// an unanchored prefix let trailing text through to Date.parse, and a value
// with no zone would be read in the server's local time).
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse an admin-supplied expires_at. Accepts null/'' (no expiry), an ISO
 * date-time WITH a zone (`Z` or ±hh:mm), or a bare YYYY-MM-DD (the END of
 * that day, UTC — Iceland's clock). Anything else is refused. A non-null
 * value must lie in the future and within MAX_AHEAD_MS.
 * Returns { ok: true, value: Date|null } or { ok: false, messageKey }.
 */
function parseExpiresAt(raw, now = Date.now()) {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, messageKey: 'errors.admin.expiresAtInvalid' };
  const s = raw.trim();
  let ms;
  if (ISO_DATE.test(s)) {
    ms = Date.parse(`${s}T23:59:59.999Z`);
  } else if (ISO_DATE_TIME.test(s)) {
    ms = Date.parse(s);
  } else {
    ms = NaN;
  }
  if (!Number.isFinite(ms)) return { ok: false, messageKey: 'errors.admin.expiresAtInvalid' };
  if (ms <= now) return { ok: false, messageKey: 'errors.admin.expiresAtPast' };
  if (ms - now > MAX_AHEAD_MS) return { ok: false, messageKey: 'errors.admin.expiresAtInvalid' };
  return { ok: true, value: new Date(ms) };
}

module.exports = {
  ACCOUNT_EXPIRED,
  AccountExpiredError,
  ExpiryOnAdminError,
  isExpired,
  assertNotExpired,
  validateSession,
  parseExpiresAt,
};
