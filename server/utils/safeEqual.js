'use strict';

const crypto = require('crypto');

/**
 * Constant-time string comparison for credentials that arrive in a header.
 *
 * `a !== b` on strings returns at the first differing byte, so response time
 * tells an attacker how much of a guess was right. crypto.timingSafeEqual fixes
 * that but throws on a length mismatch — which would leak the length instead —
 * so both sides are hashed first: equal-length digests, compared in constant
 * time, and nothing about the secret's length or content reaches the clock.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { safeEqual };
