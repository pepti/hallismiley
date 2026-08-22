// MCP bearer credentials (see migration 097_mcp_tokens). The plaintext token
// exists only in the mint response — this model stores and matches sha256
// hashes. High-entropy secrets (32 random bytes) don't need a slow hash the
// way passwords do; sha256 keeps the per-request lookup cheap.
const crypto = require('crypto');
const db = require('../config/database');

// Display prefix length: 'mcp_' + first 6 hex chars — enough for the admin to
// tell tokens apart in the UI, useless to an attacker.
const PREFIX_LEN = 10;

const COLUMNS = `id, user_id, name, token_prefix, kind, scopes, oauth_client_id,
                 parent_id, expires_at, last_used_at, revoked_at, created_at`;

function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

class McpToken {
  // Mint a token. Returns { token, row } — `token` is the plaintext, shown
  // once and never stored. ttlDays is clamped to [1, 365].
  static async create({ userId, name, kind = 'manual', scopes = ['read'], oauthClientId = null, parentId = null, ttlDays = 90 }) {
    const days = Math.min(365, Math.max(1, Math.floor(Number(ttlDays) || 90)));
    const token = 'mcp_' + crypto.randomBytes(32).toString('hex');
    const { rows } = await db.query(
      `INSERT INTO mcp_tokens (user_id, name, token_hash, token_prefix, kind, scopes,
                               oauth_client_id, parent_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9 || ' days')::interval)
       RETURNING ${COLUMNS}`,
      [String(userId), String(name).slice(0, 100), hashToken(token), token.slice(0, PREFIX_LEN),
       kind, scopes, oauthClientId, parentId, String(days)]
    );
    return { token, row: rows[0] };
  }

  // Resolve a presented plaintext to a live token row, or null. The sha256 of
  // a 32-byte-random secret is itself unguessable, so the indexed hash lookup
  // is safe; the timingSafeEqual re-check guards the comparison itself.
  static async findLiveByPlaintext(plaintext) {
    if (typeof plaintext !== 'string' || !plaintext.startsWith('mcp_') || plaintext.length > 200) return null;
    const hash = hashToken(plaintext);
    const { rows } = await db.query(
      `SELECT ${COLUMNS}, token_hash FROM mcp_tokens
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [hash]
    );
    const row = rows[0];
    if (!row) return null;
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(row.token_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    delete row.token_hash;
    return row;
  }

  // Everything the admin UI lists — newest first, hash never leaves the DB.
  static async listAll() {
    const qualified = COLUMNS.split(',').map((c) => 't.' + c.trim()).join(', ');
    const { rows } = await db.query(
      `SELECT ${qualified}, u.username, u.email
         FROM mcp_tokens t JOIN users u ON u.id = t.user_id
        ORDER BY t.created_at DESC`
    );
    return rows;
  }

  static async revoke(id) {
    const { rows } = await db.query(
      `UPDATE mcp_tokens SET revoked_at = NOW()
        WHERE id = $1 AND revoked_at IS NULL
       RETURNING ${COLUMNS}`,
      [Number(id)]
    );
    return rows[0] || null;
  }

  // Fire-and-forget freshness marker; never let it fail a request.
  static async touchLastUsed(id) {
    try {
      await db.query('UPDATE mcp_tokens SET last_used_at = NOW() WHERE id = $1', [Number(id)]);
    } catch { /* cosmetic */ }
  }
}

module.exports = McpToken;
