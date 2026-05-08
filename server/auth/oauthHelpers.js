// Shared helpers used by every OAuth provider controller (Google, Facebook, …).

const crypto             = require('crypto');
const { query: dbQuery } = require('../config/database');

// Path segments we never want to bounce a user back to after login/signup —
// landing on the auth page they came from would create a redirect loop or a
// confusing UX. Substring match against the lowercased path so locale prefixes
// like /en/login or /is/signup are caught too.
const AUTH_PATH_BLOCKLIST = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
];

// Validate a `returnTo` value supplied by the SPA on /auth/<provider>?returnTo=…
// Reject anything that could be used as an open redirect: protocol-relative URLs,
// absolute URLs, schemes (mailto:, javascript:), backslash-tricks (browsers
// normalize `\` → `/`, so `/\evil.com` becomes `//evil.com`), null-byte injection,
// over-long values, and auth pages that would loop. The SPA only ever sends
// `window.location.pathname`, so a strict allowlist is fine.
function isSafeReturnTo(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 500) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('\\')) return false;
  if (value.includes('\0') || value.toLowerCase().includes('%00')) return false;
  if (value.includes('://')) return false;
  const lower = value.toLowerCase();
  for (const blocked of AUTH_PATH_BLOCKLIST) {
    if (lower.includes(blocked)) return false;
  }
  return true;
}

// Derive a unique username from display name or email local-part. Used when
// creating a brand-new user off an OAuth profile that has no username yet.
async function generateUniqueUsername(email, name) {
  const raw  = name || email.split('@')[0] || 'user';
  // Keep ASCII alphanumerics plus the lowercase Icelandic letters so names like
  // "Jón Þórsson" survive as "jónþórsson" instead of being mangled to "jnrsson".
  const base = raw.toLowerCase().replace(/[^a-z0-9áéíóúýðþæö]+/g, '').slice(0, 40) || 'user';
  // Signup validator requires ≥ 3 chars — pad if too short.
  const padded = base.length < 3 ? (base + '123').slice(0, 40) : base;

  for (let i = 0; i < 5; i++) {
    const suffix    = i === 0 ? '' : crypto.randomBytes(2).toString('hex');
    const candidate = (padded + suffix).slice(0, 40);
    const { rows } = await dbQuery(
      `SELECT 1 FROM users WHERE username = $1`,
      [candidate],
    );
    if (rows.length === 0) return candidate;
  }
  // Fallback — effectively guaranteed unique.
  return `user_${crypto.randomBytes(6).toString('hex')}`;
}

module.exports = { generateUniqueUsername, isSafeReturnTo };
