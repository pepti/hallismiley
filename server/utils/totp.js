'use strict';
/*
 * TOTP (RFC 6238) over HMAC-SHA1 — the algorithm every authenticator app speaks.
 *
 * Implemented on node:crypto rather than pulling in a dependency: the whole thing
 * is ~40 lines of well-specified arithmetic, and an auth primitive is exactly the
 * kind of code you want to be able to read end to end.
 *
 * Deliberate choices, each of which an authenticator app depends on:
 *   • SHA-1, 6 digits, 30-second step — the RFC 6238 defaults. Google Authenticator
 *     and friends IGNORE the algorithm/digits parameters in an otpauth:// URI, so
 *     anything else silently produces codes that never match.
 *   • Base32 (RFC 4648, no padding) for the shared secret — the only encoding the
 *     apps accept for manual entry.
 *   • 160-bit secrets, the RFC's recommendation for SHA-1.
 *
 * verify() returns the matched STEP, not just a boolean, so the caller can persist
 * it and refuse to accept the same code twice — without that, a code shouted over
 * a shoulder stays valid for the rest of its 30-second window.
 */

const crypto = require('crypto');

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS       = 6;
const STEP_SECONDS = 30;
// How many steps either side of "now" to accept. 1 → a ±30s tolerance for clock
// drift between the phone and the server. Higher values widen the window an
// attacker can replay in; 1 is the usual compromise.
const DEFAULT_WINDOW = 1;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// Tolerant of the shapes humans produce: lower case, spaces, and the '=' padding
// some apps show. Returns null on any character outside the alphabet rather than
// silently decoding to something wrong.
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean) return null;
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32-encoded for authenticator apps. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * The otpauth:// URI an authenticator app scans.
 * `label` is what the user sees in their app — include the site so a person with
 * several accounts can tell them apart.
 */
function otpauthUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function stepFor(atMs) {
  return Math.floor(atMs / 1000 / STEP_SECONDS);
}

/** The 6-digit code for a given counter step. */
function codeForStep(secretBase32, step) {
  const key = base32Decode(secretBase32);
  if (!key || key.length === 0) return null;

  // 8-byte big-endian counter. writeBigUInt64BE keeps this correct past 2038,
  // where a 32-bit write would wrap.
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  // RFC 4226 dynamic truncation.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The code valid right now — used by tests and by the enrolment preview. */
function generateCode(secretBase32, atMs = Date.now()) {
  return codeForStep(secretBase32, stepFor(atMs));
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verify a user-supplied code.
 *
 * @returns {{valid: boolean, step: number|null}} `step` is the counter the code
 *   matched. Persist it and reject anything <= it next time, so a code cannot be
 *   replayed inside its own window.
 */
function verifyCode(secretBase32, code, { window = DEFAULT_WINDOW, atMs = Date.now(), lastUsedStep = null } = {}) {
  const cleaned = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return { valid: false, step: null };
  if (!base32Decode(secretBase32)) return { valid: false, step: null };

  const current = stepFor(atMs);
  for (let offset = -window; offset <= window; offset++) {
    const step = current + offset;
    if (step < 0) continue;
    // Replay guard: never accept a step already spent.
    if (lastUsedStep !== null && step <= Number(lastUsedStep)) continue;
    const expected = codeForStep(secretBase32, step);
    if (expected && timingSafeEqualStr(expected, cleaned)) return { valid: true, step };
  }
  return { valid: false, step: null };
}

module.exports = {
  DIGITS, STEP_SECONDS, DEFAULT_WINDOW,
  base32Encode, base32Decode,
  generateSecret, otpauthUri,
  codeForStep, generateCode, verifyCode,
};
