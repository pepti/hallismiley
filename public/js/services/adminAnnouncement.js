// Admin → Tilkynning (the site announcement) API client (harvest2-lane7a,
// ported from icelandicstore #200). GET the settings + whether it is live now;
// PATCH a partial update (credentials + CSRF header, throw on non-2xx).
import { getCSRFToken } from './auth.js';

async function _csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function getAnnouncement() {
  const res  = await fetch('/api/v1/admin/announcement', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load the announcement');
  return data; // { settings, status: { active, timezone } }
}

export async function updateAnnouncement(patch) {
  const res = await fetch('/api/v1/admin/announcement', {
    method: 'PATCH', credentials: 'include', headers: await _csrfHeaders(), body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data; // { settings, status }
}
