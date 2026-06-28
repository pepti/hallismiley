// Shared token helpers for email-driven flows (magic login, one-click approval,
// email verification, password reset). Tokens are 256-bit random hex. Long-lived
// or bearer tokens (magic login, approval action) are stored sha256-HASHED so a
// database read never yields a usable credential — look them up by hashing the
// presented value, never by storing the plaintext.
const crypto = require('crypto');
const { query: dbQuery } = require('../config/database');

/** Generate a cryptographically-random hex token (64 chars / 256 bits). */
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** sha256 hex digest of a token, for hashed-at-rest storage and lookup. */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// users.username is UNIQUE NOT NULL and constrained to USERNAME_RE
// (3-40 chars: ASCII alphanumerics, underscore, Icelandic letters). Party guests
// sign up with only name + email, so derive a handle from the email-local part
// (falling back to the name), strip it to the safe ASCII subset, and disambiguate
// with a short random suffix until it's free.
function sanitizeHandle(base) {
  return String(base || '')
    .toLowerCase()
    .normalize('NFKD')            // decompose accents: "jón" -> "jon"
    .replace(/[^a-z0-9_]/g, '')   // keep the safe subset of USERNAME_RE
    .slice(0, 24);
}

/**
 * Generate a unique username for a guest account from their email/name.
 * Tries the bare handle first, then appends a random suffix; falls back to a
 * fully-random guest_<hex> handle. Always returns a value matching USERNAME_RE.
 */
async function generateGuestUsername(email, name) {
  let base = sanitizeHandle(String(email || '').split('@')[0]) || sanitizeHandle(name);
  if (base.length < 3) base = `guest${base}`;
  base = base.slice(0, 30);

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0
      ? base
      : `${base}_${crypto.randomBytes(2).toString('hex')}`;
    const { rows } = await dbQuery(
      'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [candidate]
    );
    if (rows.length === 0) return candidate;
  }
  return `guest_${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = { makeToken, hashToken, generateGuestUsername };
