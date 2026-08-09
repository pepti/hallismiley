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
