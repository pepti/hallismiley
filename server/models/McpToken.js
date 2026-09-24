// MCP bearer credentials (see migration 088_mcp_tokens). The plaintext token
// exists only in the mint response — this model stores and matches sha256
// hashes. High-entropy secrets (32 random bytes) don't need a slow hash the
// way passwords do; sha256 keeps the per-request lookup cheap.
//
// Three kinds share the table:
//   manual  — minted by an admin on /admin/mcp (days, pasted into Claude Code);
//   access  — issued by the OAuth token endpoint (an hour), a child of…
//   refresh — …the OAuth grant itself (30 days, rotated on every use). A
//             refresh token is NEVER a bearer credential on /api/v1/mcp:
//             findLiveByPlaintext refuses it unless asked for it by kind.
// parent_id links an access token to the refresh token that issued it, and a
// rotated refresh token to its predecessor, so revoking a connection revokes
// everything under it (revoke() walks the descendants).
const crypto = require('crypto');
const db = require('../config/database');

// Display prefix length: 'mcp_' + first 6 hex chars — enough for the admin to
// tell tokens apart in the UI, useless to an attacker.
const PREFIX_LEN = 10;

const COLUMNS = `id, user_id, name, token_prefix, kind, scopes, oauth_client_id,
                 parent_id, expires_at, last_used_at, revoked_at, created_at`;

// The kinds that may authenticate a call to /api/v1/mcp.
const BEARER_KINDS = ['manual', 'access'];

function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

function wellFormed(plaintext) {
  return typeof plaintext === 'string' && plaintext.startsWith('mcp_') && plaintext.length <= 200;
}

class McpToken {
  // Mint a token. Returns { token, row } — `token` is the plaintext, shown
  // once and never stored. ttlDays is clamped to [1, 365]; ttlSeconds (the
  // OAuth tokens) wins when given, clamped to [60 s, 365 days].
  static async create({ userId, name, kind = 'manual', scopes = ['read'], oauthClientId = null, parentId = null, ttlDays = 90, ttlSeconds = null }) {
    const seconds = ttlSeconds != null
      ? Math.min(365 * 86400, Math.max(60, Math.floor(Number(ttlSeconds) || 3600)))
      : Math.min(365, Math.max(1, Math.floor(Number(ttlDays) || 90))) * 86400;
    const token = 'mcp_' + crypto.randomBytes(32).toString('hex');
    const { rows } = await db.query(
      `INSERT INTO mcp_tokens (user_id, name, token_hash, token_prefix, kind, scopes,
                               oauth_client_id, parent_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() + ($9 || ' seconds')::interval)
       RETURNING ${COLUMNS}`,
      [String(userId), String(name).slice(0, 100), hashToken(token), token.slice(0, PREFIX_LEN),
       kind, scopes, oauthClientId, parentId, String(seconds)]
    );
    return { token, row: rows[0] };
  }

  // Resolve a presented plaintext to a live token row of one of `kinds`, or
  // null. Default: the bearer kinds — a refresh token presented to the MCP
  // endpoint is simply not a credential there. The sha256 of a 32-byte-random
  // secret is itself unguessable, so the indexed hash lookup is safe; the
  // timingSafeEqual re-check guards the comparison itself.
  static async findLiveByPlaintext(plaintext, { kinds = BEARER_KINDS } = {}) {
    const row = await McpToken.findByPlaintext(plaintext);
    if (!row || row.revoked_at || new Date(row.expires_at) <= new Date() || !kinds.includes(row.kind)) return null;
    return row;
  }

  // Any row for this plaintext, revoked or expired included — the refresh
  // grant needs to see a REPLAYED (already rotated) refresh token to revoke
  // the grant it belongs to. Callers decide liveness.
  static async findByPlaintext(plaintext) {
    if (!wellFormed(plaintext)) return null;
    const hash = hashToken(plaintext);
    const { rows } = await db.query(
      `SELECT ${COLUMNS}, token_hash FROM mcp_tokens WHERE token_hash = $1`,
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

  // What the admin UI lists — newest first, hash never leaves the DB. OAuth
  // ACCESS tokens are left out: they live an hour and hang off their refresh
  // token, which is the row that stands for the connection (revoking it
  // revokes them). The client's registered name rides along for OAuth rows.
  static async listAll() {
    const qualified = COLUMNS.split(',').map((c) => 't.' + c.trim()).join(', ');
    const { rows } = await db.query(
      `SELECT ${qualified}, u.username, u.email, c.client_name
         FROM mcp_tokens t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN mcp_oauth_clients c ON c.client_id = t.oauth_client_id
        WHERE t.kind <> 'access'
          -- one row per OAuth connection: the newest refresh token of its
          -- rotation chain (the ones it replaced are history, not connections)
          AND NOT EXISTS (SELECT 1 FROM mcp_tokens n WHERE n.parent_id = t.id AND n.kind = 'refresh')
        ORDER BY t.created_at DESC`
    );
    return rows;
  }

  // Revoke one token and every token issued under it (its access tokens, and
  // for a refresh token its rotated successors'). A REFRESH token stands for
  // an OAuth connection, so revoking one ends the whole grant — every token
  // that client holds for that user, including the previous access token a
  // rotation left running (security review, 2026-09-24). Returns the row
  // asked for, or null when it was already revoked or does not exist.
  static async revoke(id) {
    const { rows } = await db.query(
      `UPDATE mcp_tokens SET revoked_at = NOW()
        WHERE id = $1 AND revoked_at IS NULL
       RETURNING ${COLUMNS}`,
      [Number(id)]
    );
    if (!rows[0]) return null;
    if (rows[0].kind === 'refresh' && rows[0].oauth_client_id) {
      await McpToken.revokeClientGrant(rows[0].user_id, rows[0].oauth_client_id);
      return rows[0];
    }
    await db.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM mcp_tokens WHERE parent_id = $1
         UNION
         SELECT t.id FROM mcp_tokens t JOIN tree ON t.parent_id = tree.id
       )
       UPDATE mcp_tokens SET revoked_at = NOW()
        WHERE id IN (SELECT id FROM tree) AND revoked_at IS NULL`,
      [Number(id)]
    );
    return rows[0];
  }

  // Retire ONE token without touching its children — refresh-token rotation:
  // the presented refresh token dies, its access token keeps its hour. The
  // conditional UPDATE is the race guard: of two requests presenting the
  // same refresh token, exactly one gets true.
  static async retire(id) {
    const { rowCount } = await db.query(
      'UPDATE mcp_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
      [Number(id)]
    );
    return rowCount === 1;
  }

  // Revoke every live token one OAuth client holds for one user — the answer
  // to a replayed authorization code or refresh token (OAuth 2.1 §4.1.2,
  // §4.3.1: treat reuse as theft and end the grant). Returns the count.
  static async revokeClientGrant(userId, clientId) {
    const { rowCount } = await db.query(
      `UPDATE mcp_tokens SET revoked_at = NOW()
        WHERE user_id = $1 AND oauth_client_id = $2 AND revoked_at IS NULL`,
      [String(userId), String(clientId)]
    );
    return rowCount;
  }

  // Revoke every live token a user owns — when they stop being an admin or are
  // disabled (ice #418). server/mcp/owner.js already refuses such an owner on
  // every call; revoking the rows as well keeps Admin → MCP from listing them
  // as live. Returns how many were revoked.
  static async revokeAllForUser(userId) {
    const { rowCount } = await db.query(
      `UPDATE mcp_tokens SET revoked_at = NOW()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [String(userId)]
    );
    return rowCount;
  }

  // Fire-and-forget freshness marker; never let it fail a request.
  static async touchLastUsed(id) {
    try {
      await db.query('UPDATE mcp_tokens SET last_used_at = NOW() WHERE id = $1', [Number(id)]);
    } catch { /* cosmetic */ }
  }
}

McpToken.BEARER_KINDS = BEARER_KINDS;
McpToken.hashToken = hashToken;

module.exports = McpToken;
