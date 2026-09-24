// Admin "General" settings service — GET current settings + picker options,
// PATCH a partial update (credentials + CSRF header, throw on non-2xx).
import { getCSRFToken } from './auth.js';

async function _csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function getGeneralSettings() {
  const res  = await fetch('/api/v1/admin/general-settings', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load settings');
  return data; // { settings, options }
}

export async function updateGeneralSettings(patch) {
  const headers = await _csrfHeaders();
  const res = await fetch('/api/v1/admin/general-settings', {
    method:      'PATCH',
    credentials: 'include',
    headers,
    body:        JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data; // { settings }
}

// ── Module switches (/api/v1/admin/modules, R5b) ────────────────────────────
// The contract (the instance's tier) is the ceiling; a contracted module can
// be switched off and back on. Applies at once on the server.
export async function getModules() {
  const res  = await fetch('/api/v1/admin/modules', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load modules');
  return data; // { preset, modules: [{ id, contract, enabled }] }
}

export async function setModule(id, enabled) {
  const res = await fetch(`/api/v1/admin/modules/${encodeURIComponent(id)}`, {
    method: 'PATCH', credentials: 'include', headers: await _csrfHeaders(),
    body: JSON.stringify({ enabled }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data;
}
