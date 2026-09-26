// Admin → Greiðsla (checkout settings) API client (harvest2-lane7a, ported from
// icelandicstore #151). GET the settings + a read-only status block; PATCH a
// partial update (credentials + CSRF header, throw on non-2xx).
import { getCSRFToken } from './auth.js';

async function _csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function getCheckoutSettings() {
  const res  = await fetch('/api/v1/admin/checkout-settings', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load settings');
  return data; // { settings, status }
}

export async function updateCheckoutSettings(patch) {
  const res = await fetch('/api/v1/admin/checkout-settings', {
    method: 'PATCH', credentials: 'include', headers: await _csrfHeaders(), body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data; // { settings, status }
}
