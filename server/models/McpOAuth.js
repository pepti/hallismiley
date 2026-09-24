// OAuth clients and authorization requests for the MCP connector (migration
// 110_mcp_oauth; R5a, 2026-09-24). The protocol rules live in
// server/mcp/oauth.js; this is only the storage, and every state change is
// ONE conditional UPDATE so two racing requests cannot both win:
//   pending ──approve──▶ approved (code_hash set) ──consume──▶ consumed_at
//           └─deny────▶ denied
// Codes are single-use: consume() stamps consumed_at in the same statement
// that checks it, and a second presentation is reported as a replay so the
// caller can end the grant (OAuth 2.1 §4.1.2).
const crypto = require('crypto');
const db = require('../config/database');
const { REQUEST_TTL_SECONDS, CODE_TTL_SECONDS } = require('../mcp/oauth');

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

class McpOAuth {
  // ── Clients (RFC 7591, public) ─────────────────────────────────────────────

  // Anonymous registration means abandoned rows: a client that never got as
  // far as a token within a day is swept here (its codes cascade).
  static async registerClient({ clientName, redirectUris }) {
    await db.query(
      `DELETE FROM mcp_oauth_clients WHERE last_used_at IS NULL AND created_at < NOW() - INTERVAL '1 day'`
    );
    const clientId = 'mcpc_' + crypto.randomBytes(16).toString('hex');
    const { rows } = await db.query(
      `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris)
       VALUES ($1, $2, $3)
       RETURNING client_id, client_name, redirect_uris, created_at`,
      [clientId, String(clientName).slice(0, 200), redirectUris]
    );
    return rows[0];
  }

  static async findClient(clientId) {
    if (typeof clientId !== 'string' || !clientId || clientId.length > 100) return null;
    const { rows } = await db.query(
      `SELECT client_id, client_name, redirect_uris, created_at, last_used_at
         FROM mcp_oauth_clients WHERE client_id = $1`,
      [clientId]
    );
    return rows[0] || null;
  }

  static async touchClient(clientId) {
    try {
      await db.query('UPDATE mcp_oauth_clients SET last_used_at = NOW() WHERE client_id = $1', [clientId]);
    } catch { /* cosmetic */ }
  }

  // ── Authorization requests + codes ─────────────────────────────────────────

  /** A pending request, waiting for an admin on /tengja/<request_id>. Old
   *  rows (a day past expiry) are swept here, opportunistically. */
  static async createRequest({ clientId, redirectUri, codeChallenge, scopes, state, resource }) {
    await db.query(`DELETE FROM mcp_oauth_codes WHERE expires_at < NOW() - INTERVAL '1 day'`);
    const requestId = crypto.randomBytes(24).toString('hex');
    const { rows } = await db.query(
      `INSERT INTO mcp_oauth_codes (request_id, client_id, redirect_uri, code_challenge, scopes, state, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 || ' seconds')::interval)
       RETURNING *`,
      [requestId, clientId, redirectUri, codeChallenge, scopes,
        state == null ? null : String(state).slice(0, 500),
        resource == null ? null : String(resource).slice(0, 500),
        String(REQUEST_TTL_SECONDS)]
    );
    return rows[0];
  }

  /** A request still awaiting a decision, with its client's name. */
  static async findPendingRequest(requestId) {
    if (typeof requestId !== 'string' || !/^[a-f0-9]{48}$/.test(requestId)) return null;
    const { rows } = await db.query(
      `SELECT r.*, c.client_name
         FROM mcp_oauth_codes r JOIN mcp_oauth_clients c ON c.client_id = r.client_id
        WHERE r.request_id = $1 AND r.status = 'pending' AND r.expires_at > NOW()`,
      [requestId]
    );
    return rows[0] || null;
  }

  /** Approve: bind the admin, narrow the scopes, mint the code. Returns
   *  { code, row } or null when the request is no longer pending. */
  static async approveRequest(requestId, { userId, scopes }) {
    const code = crypto.randomBytes(32).toString('hex');
    const { rows } = await db.query(
      `UPDATE mcp_oauth_codes
          SET status = 'approved', user_id = $2, scopes = $3, code_hash = $4,
              expires_at = NOW() + ($5 || ' seconds')::interval
        WHERE request_id = $1 AND status = 'pending' AND expires_at > NOW()
       RETURNING *`,
      [requestId, String(userId), scopes, sha256(code), String(CODE_TTL_SECONDS)]
    );
    return rows[0] ? { code, row: rows[0] } : null;
  }

  /** Deny: returns the row (for its redirect URI and state) or null. */
  static async denyRequest(requestId) {
    const { rows } = await db.query(
      `UPDATE mcp_oauth_codes SET status = 'denied'
        WHERE request_id = $1 AND status = 'pending' AND expires_at > NOW()
       RETURNING *`,
      [requestId]
    );
    return rows[0] || null;
  }

  /** Redeem a code. { row } on success (now consumed); { replay: row } when
   *  the code was already redeemed; {} when it is unknown, unapproved or
   *  expired. */
  static async consumeCode(code) {
    if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) return {};
    const hash = sha256(code);
    const { rows } = await db.query(
      `UPDATE mcp_oauth_codes SET consumed_at = NOW()
        WHERE code_hash = $1 AND status = 'approved' AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING *`,
      [hash]
    );
    if (rows[0]) return { row: rows[0] };
    const { rows: seen } = await db.query(
      `SELECT * FROM mcp_oauth_codes WHERE code_hash = $1 AND consumed_at IS NOT NULL`,
      [hash]
    );
    return seen[0] ? { replay: seen[0] } : {};
  }

  static async setCodeToken(id, tokenId) {
    await db.query('UPDATE mcp_oauth_codes SET token_id = $2 WHERE id = $1', [id, tokenId]);
  }
}

module.exports = McpOAuth;
