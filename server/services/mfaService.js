'use strict';
/*
 * Admin two-factor sign-in — enrolment, challenge and verification.
 *
 * The controller stays thin; the rules live here so they are testable without an
 * HTTP layer and so there is exactly one place that decides whether an account is
 * protected.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT:
 *   a Lucia session is never created for a protected account until the second
 *   factor has been verified.
 *
 * That is why login() does not create a session and then "upgrade" it — a
 * half-authenticated session is a session, and anything that forgets to check the
 * upgrade flag is a bypass. Instead the password step mints a `mfa_challenges`
 * row, which is NOT a credential for anything except exchanging a correct code
 * for a real session.
 */

const crypto = require('crypto');
const { Scrypt } = require('oslo/password');
const { query: dbQuery } = require('../config/database');
const totp = require('../utils/totp');
const qrUtil = require('../utils/qr');
const logger = require('../logger');

const scrypt = new Scrypt();

// A challenge is a login in progress, not a session. Short enough that a stolen
// challenge id is near-useless, long enough to open an authenticator app and type.
const CHALLENGE_TTL_MS   = 5 * 60 * 1000;
// Wrong codes per challenge before it is destroyed and the user starts over. Low,
// because 6 digits is only a million possibilities and the challenge is the one
// place an attacker holding the password can grind.
const MAX_CHALLENGE_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;

const ISSUER = 'Icelandic Store';

/**
 * Is this account protected by a second factor?
 *
 * Scope decision (2026-08-14): admins only. Moderators reach POS and inventory but
 * not customer or financial data, and shared counter devices make enrolment
 * awkward; widening this is a deliberate later choice, not an oversight.
 */
function isProtected(user) {
  return !!user && user.role === 'admin' && user.totp_enabled === true;
}

/** Should this account be *pushed* to enrol? (Protected roles that haven't yet.) */
function shouldEnrol(user) {
  return !!user && user.role === 'admin' && user.totp_enabled !== true;
}

// ── Enrolment ───────────────────────────────────────────────────────────────

/**
 * Start enrolment: mint a secret and hand back the otpauth URI.
 *
 * The secret is stored immediately but `totp_enabled` stays FALSE, so it cannot
 * authorise anything until confirmEnrolment() proves the user's app actually
 * produces matching codes. Storing it up front is what lets the user re-open the
 * page mid-setup without silently ending up with two different secrets.
 */
async function beginEnrolment(userId, accountLabel) {
  const secret = totp.generateSecret();
  await dbQuery(
    `UPDATE users SET totp_secret = $1, totp_enabled = FALSE, totp_confirmed_at = NULL, totp_last_step = NULL
      WHERE id = $2`,
    [secret, userId]
  );
  const uri = totp.otpauthUri({ secret, account: accountLabel, issuer: ISSUER });

  // The QR is generated server-side and handed over as a data: URI, so no QR
  // library reaches the browser and the client only ever sets an <img src>.
  // The plain `secret` is still returned: scanning fails often enough (bad
  // camera, desktop-only setup, a phone that won't focus) that removing the
  // manual fallback would just move the frustration somewhere less recoverable.
  //
  // The QR is a CONVENIENCE, so its failure must not take enrolment down with
  // it. qrcode-generator refuses payloads past QR version 40 by `throw 'code
  // length overflow.'` — a bare string, not an Error, so it would reach the
  // central error middleware with no .message and surface as an opaque 500 on
  // an endpoint that would otherwise have worked fine via manual entry.
  // Falling back to qr: null activates the `${setup.qr ? …}` branch the
  // enrolment UI already carries.
  let qr = null;
  try {
    qr = qrUtil.svgDataUri(uri);
  } catch (err) {
    logger.warn({ err: String(err && err.message ? err.message : err), userId },
      'TOTP QR generation failed — falling back to manual key entry');
  }

  return { secret, uri, qr };
}

/**
 * Confirm enrolment with a code from the user's app, then issue recovery codes.
 *
 * Returns the plaintext recovery codes ONCE — they are stored hashed and can never
 * be shown again. Any previously issued codes are discarded, so re-enrolling can't
 * leave stale fallbacks working.
 */
async function confirmEnrolment(userId, code) {
  const { rows } = await dbQuery('SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [userId]);
  const row = rows[0];
  if (!row || !row.totp_secret) return { ok: false, reason: 'NOT_STARTED' };
  if (row.totp_enabled) return { ok: false, reason: 'ALREADY_ENABLED' };

  const result = totp.verifyCode(row.totp_secret, code);
  if (!result.valid) return { ok: false, reason: 'BAD_CODE' };

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  const hashes = await Promise.all(codes.map((c) => scrypt.hash(normaliseRecovery(c))));

  await dbQuery('DELETE FROM user_recovery_codes WHERE user_id = $1', [userId]);
  for (const hash of hashes) {
    await dbQuery('INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, hash]);
  }
  await dbQuery(
    `UPDATE users SET totp_enabled = TRUE, totp_confirmed_at = NOW(), totp_last_step = $1 WHERE id = $2`,
    [result.step, userId]
  );

  return { ok: true, recoveryCodes: codes };
}

/** Turn 2FA off and destroy every associated secret and fallback. */
async function disable(userId) {
  await dbQuery('DELETE FROM user_recovery_codes WHERE user_id = $1', [userId]);
  await dbQuery(
    `UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_confirmed_at = NULL, totp_last_step = NULL
      WHERE id = $1`,
    [userId]
  );
}

// Human-friendly but high-entropy: 10 chars of Crockford-ish base32 in two groups,
// ~50 bits. Excludes the characters people confuse when copying off paper.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRecoveryCode() {
  const pick = () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
  const part = (n) => Array.from({ length: n }, pick).join('');
  return `${part(5)}-${part(5)}`;
}
function normaliseRecovery(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ── Challenge ───────────────────────────────────────────────────────────────

async function createChallenge(userId, { ip = null, userAgent = null } = {}) {
  // Opportunistic cleanup — no scheduler needed for a table this small.
  await dbQuery('DELETE FROM mfa_challenges WHERE expires_at < NOW()');
  const { rows } = await dbQuery(
    `INSERT INTO mfa_challenges (user_id, expires_at, ip_address, user_agent)
     VALUES ($1, NOW() + ($2::int * INTERVAL '1 millisecond'), $3, $4)
     RETURNING id`,
    [userId, CHALLENGE_TTL_MS, ip, userAgent]
  );
  return rows[0].id;
}

/**
 * Exchange a challenge + code for the user it authenticates.
 *
 * Accepts either a TOTP code or an unused recovery code. Consumes the challenge on
 * success, and destroys it once attempts run out — a wrong code must not leave an
 * attacker an unlimited number of further guesses.
 *
 * @returns {{ok: true, userId: string, usedRecoveryCode: boolean}} or {{ok: false, reason: string}}
 */
async function verifyChallenge(challengeId, code) {
  if (!challengeId || !/^[0-9a-f-]{36}$/i.test(String(challengeId))) return { ok: false, reason: 'INVALID' };

  const { rows } = await dbQuery(
    `SELECT c.id, c.user_id, c.attempts, c.expires_at,
            u.totp_secret, u.totp_enabled, u.totp_last_step, u.disabled
       FROM mfa_challenges c JOIN users u ON u.id = c.user_id
      WHERE c.id = $1`,
    [challengeId]
  );
  const ch = rows[0];
  if (!ch) return { ok: false, reason: 'INVALID' };

  if (new Date(ch.expires_at) <= new Date()) {
    await dbQuery('DELETE FROM mfa_challenges WHERE id = $1', [challengeId]);
    return { ok: false, reason: 'EXPIRED' };
  }
  // Re-check state that may have changed since the password step.
  if (ch.disabled || !ch.totp_enabled || !ch.totp_secret) {
    await dbQuery('DELETE FROM mfa_challenges WHERE id = $1', [challengeId]);
    return { ok: false, reason: 'INVALID' };
  }

  const totpResult = totp.verifyCode(ch.totp_secret, code, { lastUsedStep: ch.totp_last_step });
  if (totpResult.valid) {
    await dbQuery('UPDATE users SET totp_last_step = $1 WHERE id = $2', [totpResult.step, ch.user_id]);
    await dbQuery('DELETE FROM mfa_challenges WHERE id = $1', [challengeId]);
    return { ok: true, userId: ch.user_id, usedRecoveryCode: false };
  }

  // Not a TOTP code — it may be a recovery code.
  const recovery = await consumeRecoveryCode(ch.user_id, code);
  if (recovery) {
    await dbQuery('DELETE FROM mfa_challenges WHERE id = $1', [challengeId]);
    return { ok: true, userId: ch.user_id, usedRecoveryCode: true };
  }

  const attempts = (ch.attempts || 0) + 1;
  if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
    await dbQuery('DELETE FROM mfa_challenges WHERE id = $1', [challengeId]);
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  }
  await dbQuery('UPDATE mfa_challenges SET attempts = $1 WHERE id = $2', [attempts, challengeId]);
  return { ok: false, reason: 'BAD_CODE', attemptsRemaining: MAX_CHALLENGE_ATTEMPTS - attempts };
}

/** Verify-and-burn. Returns true only if an UNUSED code matched. */
async function consumeRecoveryCode(userId, code) {
  const candidate = normaliseRecovery(code);
  // A recovery code is 10 chars; skip the hash work for anything that can't be one.
  if (candidate.length !== 10) return false;

  const { rows } = await dbQuery(
    'SELECT id, code_hash FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );
  for (const row of rows) {
    let match;
    try { match = await scrypt.verify(row.code_hash, candidate); } catch { match = false; }
    if (match) {
      // Conditional UPDATE so two concurrent requests cannot both spend it.
      const { rowCount } = await dbQuery(
        'UPDATE user_recovery_codes SET used_at = NOW() WHERE id = $1 AND used_at IS NULL',
        [row.id]
      );
      return rowCount === 1;
    }
  }
  return false;
}

async function remainingRecoveryCodes(userId) {
  const { rows } = await dbQuery(
    'SELECT COUNT(*)::int AS n FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
    [userId]
  );
  return rows[0]?.n ?? 0;
}

module.exports = {
  CHALLENGE_TTL_MS, MAX_CHALLENGE_ATTEMPTS, RECOVERY_CODE_COUNT,
  isProtected, shouldEnrol,
  beginEnrolment, confirmEnrolment, disable,
  createChallenge, verifyChallenge,
  consumeRecoveryCode, remainingRecoveryCodes,
  generateRecoveryCode, normaliseRecovery,
};
