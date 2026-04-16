// Shared helpers used by every OAuth provider controller (Google, Facebook, …).

const crypto             = require('crypto');
const { query: dbQuery } = require('../config/database');

// Derive a unique username from display name or email local-part. Used when
// creating a brand-new user off an OAuth profile that has no username yet.
async function generateUniqueUsername(email, name) {
  const raw  = name || email.split('@')[0] || 'user';
  const base = raw.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'user';
  // Signup validator requires ≥ 3 chars — pad if too short.
  const padded = base.length < 3 ? (base + '123').slice(0, 20) : base;

  for (let i = 0; i < 5; i++) {
    const suffix    = i === 0 ? '' : crypto.randomBytes(2).toString('hex');
    const candidate = (padded + suffix).slice(0, 32);
    const { rows } = await dbQuery(
      `SELECT 1 FROM users WHERE username = $1`,
      [candidate],
    );
    if (rows.length === 0) return candidate;
  }
  // Fallback — effectively guaranteed unique.
  return `user_${crypto.randomBytes(6).toString('hex')}`;
}

module.exports = { generateUniqueUsername };
