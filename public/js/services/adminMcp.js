// Admin MCP-token API client (/api/v1/admin/mcp-tokens). Mirrors
// adminGeneralSettings.js: {error} envelope, CSRF header on writes.
import { getCSRFToken } from './auth.js';

const BASE = '/api/v1/admin/mcp-tokens';

async function _csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function listMcpTokens() {
  const res = await fetch(BASE, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load tokens');
  return data; // { enabled, allowed_scopes, app_env, tokens }
}

export async function createMcpToken({ name, scopes, ttlDays }) {
  const res = await fetch(BASE, {
    method: 'POST', credentials: 'include', headers: await _csrfHeaders(),
    body: JSON.stringify({ name, scopes, ttl_days: ttlDays }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create token');
  return data; // { token (plaintext, shown once), row }
}

export async function revokeMcpToken(id) {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}/revoke`, {
    method: 'POST', credentials: 'include', headers: await _csrfHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to revoke token');
  return data;
}

// ── OAuth consent (/tengja/<id>, R5a) ────────────────────────────────────────
// A pending authorization request from a Claude client; the admin approves or
// denies it and the page follows the returned redirect back to the client.
const REQUESTS = '/api/v1/oauth/requests';

export async function getOAuthRequest(id) {
  const res = await fetch(`${REQUESTS}/${encodeURIComponent(id)}`, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Failed to load request'); e.status = res.status; throw e; }
  return data; // { client_name, redirect_uri, redirect_host, scopes, write_allowed, expires_at }
}

export async function decideOAuthRequest(id, decision, { allowWrite = false } = {}) {
  const res = await fetch(`${REQUESTS}/${encodeURIComponent(id)}/${decision === 'approve' ? 'approve' : 'deny'}`, {
    method: 'POST', credentials: 'include', headers: await _csrfHeaders(),
    body: JSON.stringify({ allow_write: allowWrite === true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Failed'); e.status = res.status; throw e; }
  return data; // { redirect }
}
