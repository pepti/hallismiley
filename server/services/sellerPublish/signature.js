'use strict';
// HMAC signature for the ops → public seller publish (D-020).
//
// Header:  X-Seller-Publish-Signature: t=<unix seconds>,v1=<hex sha256>
// MAC:     HMAC-SHA256(SELLER_PUBLISH_SECRET, `${t}.${rawBody}`)
//
// The Stripe scheme, for the same reasons: the timestamp is inside the MAC so a
// captured request cannot be replayed outside the tolerance window, and the MAC
// covers the RAW bytes (the route mounts express.raw before express.json, like
// the Stripe webhook) so no re-serialisation can change what was signed. Replay
// INSIDE the window is stopped one layer down: every snapshot carries a unique
// snapshot_id and a generated_at that must be newer than the last one applied.
const crypto = require('crypto');

const HEADER = 'x-seller-publish-signature';
const TOLERANCE_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;

function secretFromEnv() {
  const s = process.env.SELLER_PUBLISH_SECRET || '';
  return s.length >= MIN_SECRET_LENGTH ? s : null;
}

function mac(secret, t, rawBody) {
  return crypto.createHmac('sha256', secret)
    .update(`${t}.`)
    .update(rawBody)
    .digest('hex');
}

function sign(secret, rawBody, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${mac(secret, t, rawBody)}`;
}

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 * The reason is for the server log only — the route answers every failure with
 * the same 401 so a caller learns nothing about which part was wrong.
 */
function verify(secret, header, rawBody, now = Math.floor(Date.now() / 1000)) {
  if (!secret) return { ok: false, reason: 'no secret configured' };
  if (typeof header !== 'string' || !header) return { ok: false, reason: 'missing header' };
  const parts = Object.fromEntries(header.split(',').map(p => {
    const i = p.indexOf('=');
    return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : [p.trim(), ''];
  }));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || t <= 0) return { ok: false, reason: 'bad timestamp' };
  if (Math.abs(now - t) > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp outside tolerance' };
  if (!/^[0-9a-f]{64}$/.test(parts.v1 || '')) return { ok: false, reason: 'bad signature format' };
  const expected = Buffer.from(mac(secret, t, rawBody), 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  if (!crypto.timingSafeEqual(expected, given)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}

module.exports = { HEADER, TOLERANCE_SECONDS, MIN_SECRET_LENGTH, secretFromEnv, sign, verify };
