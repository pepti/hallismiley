// Admin sidebar layout client — GET/PATCH the per-admin nav config.
import { getCSRFToken } from './auth.js';

async function _csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function fetchNavConfig() {
  const res  = await fetch('/api/v1/admin/nav-config', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load navigation layout');
  return data.config ?? null; // snapshot | null
}

export async function saveNavConfig(config) {
  const headers = await _csrfHeaders();
  const res = await fetch('/api/v1/admin/nav-config', {
    method: 'PATCH', credentials: 'include', headers,
    body: JSON.stringify({ config: config ?? null }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save navigation layout');
  return data.config ?? null;
}
