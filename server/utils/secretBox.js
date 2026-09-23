'use strict';
/*
 * Encryption at rest for small secrets the server must be able to READ BACK —
 * today the admin TOTP secret (mfaService.js). A password is hashed because it
 * only ever needs comparing; a TOTP secret has to be fed to HMAC on every
 * sign-in, so hashing is not an option and a database dump used to carry every
 * admin's second factor in the clear (users.totp_secret, plain TEXT).
 *
 * AES-256-GCM. The key is TOTP_ENC_KEY — 32 bytes, base64 or hex — and lives
 * where the other secrets live (a Key Vault reference on Azure), never in the
 * database it protects. Each value gets a fresh 12-byte IV; the row's user id
 * is bound in as associated data, so a ciphertext copied onto another account
 * does not decrypt there.
 *
 * Format: `v1:<iv>:<tag>:<ciphertext>`, each part base64. The version prefix is
 * what lets the key or the algorithm change later without guessing at old rows.
 */

const crypto = require('crypto');

const VERSION = 'v1';
const KEY_ENV = 'TOTP_ENC_KEY';

/** The key, or null when none is configured. Throws on a malformed one — a key
 *  that is set but unusable must not silently mean "store it in plaintext". */
function loadKey() {
  const raw = (process.env[KEY_ENV] || '').trim();
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to exactly 32 bytes (got ${key.length}) — generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
  }
  return key;
}

function isConfigured() {
  return loadKey() !== null;
}

function seal(plaintext, aad) {
  const key = loadKey();
  if (!key) throw new Error(`${KEY_ENV} is not configured`);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

/** Throws if the value was tampered with, belongs to another `aad`, or was
 *  sealed under a different key. Callers decide what that means. */
function open(sealed, aad) {
  const key = loadKey();
  if (!key) throw new Error(`${KEY_ENV} is not configured`);
  const [version, iv, tag, ct] = String(sealed).split(':');
  if (version !== VERSION || !iv || !tag || !ct) throw new Error('unrecognised sealed value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(String(aad)));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { isConfigured, seal, open, KEY_ENV };
