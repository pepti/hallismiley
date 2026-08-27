// Handbók sölufólks API client (admin view 'handbok'). Reads are available to
// any role holding the view; the manage/write surface is admin/moderator only
// and sends CSRF (used by the editor, chunk 3 of the sales-handbook program).
import { getCSRFToken } from './auth.js';

async function csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

async function getJSON(url, fallback) {
  const res  = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

async function sendJSON(method, url, body, fallback) {
  const res = await fetch(url, {
    method, credentials: 'include', headers: await csrfHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

// ── Read (requireView('handbok')) ──────────────────────────────────────────
export function getGuides()     { return getJSON('/api/v1/admin/handbok', 'Failed to load guides'); }
export function getGuide(slug)  { return getJSON('/api/v1/admin/handbok/' + encodeURIComponent(slug), 'Guide not found'); }

// ── Manage (admin/moderator) ───────────────────────────────────────────────
export function getManageList()    { return getJSON('/api/v1/admin/handbok/manage', 'Failed to load guides'); }
export function getGuidePreview(s) { return getJSON('/api/v1/admin/handbok/' + encodeURIComponent(s) + '/preview', 'Guide not found'); }
export function createGuide(body)  { return sendJSON('POST',  '/api/v1/admin/handbok', body, 'Create failed'); }
export function updateGuide(id, body) { return sendJSON('PATCH', '/api/v1/admin/handbok/' + id, body, 'Update failed'); }
export function deleteGuide(id)    { return sendJSON('DELETE', '/api/v1/admin/handbok/' + id, undefined, 'Delete failed'); }
export function reorderGuides(order) { return sendJSON('PUT', '/api/v1/admin/handbok/reorder', { order }, 'Reorder failed'); }
