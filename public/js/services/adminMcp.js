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
