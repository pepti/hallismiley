// Background library API client — the enable flag, sections and media behind
// /api/v1/admin/background. JSON mutations carry the CSRF header; the upload
// uses multipart FormData and deliberately sets no Content-Type so the browser
// can add the multipart boundary. Every endpoint here is admin-gated server-side.
import { getCSRFToken } from './auth.js';

const BASE = '/api/v1/admin/background';

async function csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

async function _get(path, fallbackMsg) {
  const res  = await fetch(`${BASE}${path}`, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallbackMsg);
  return data;
}

async function _send(method, path, body, fallbackMsg) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: await csrfHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallbackMsg);
  return data;
}

// ── Landing config (shared with LandingBackgroundAdmin's own fetches) ────────
export function getLanding() { return _get('/landing', 'Failed to load landing background'); }

// ── Library enable flag ──────────────────────────────────────────────────────
export function getLibraryFlag()          { return _get('/library', 'Failed to load library settings'); }
export function updateLibraryFlag(enabled) { return _send('PATCH', '/library', { enabled }, 'Save failed'); }

// ── Sections ─────────────────────────────────────────────────────────────────
export function listSections()          { return _get('/sections', 'Failed to load sections'); }
export function createSection(body)     { return _send('POST', '/sections', body, 'Create failed'); }
export function updateSection(id, patch) { return _send('PATCH', `/sections/${id}`, patch, 'Update failed'); }
export function deleteSection(id)       { return _send('DELETE', `/sections/${id}`, undefined, 'Delete failed'); }
export function reorderSections(order)  { return _send('PATCH', '/sections/reorder', { order }, 'Reorder failed'); }

// ── Media ────────────────────────────────────────────────────────────────────
export function listMedia()            { return _get('/media', 'Failed to load media'); }
export function updateMedia(id, patch) { return _send('PATCH', `/media/${id}`, patch, 'Update failed'); }
export function deleteMedia(id)        { return _send('DELETE', `/media/${id}`, undefined, 'Delete failed'); }
export function reorderMedia(order)    { return _send('PATCH', '/media/reorder', { order }, 'Reorder failed'); }

export async function uploadMedia(file, sectionId) {
  const token = await getCSRFToken();
  const fd = new FormData();
  fd.append('file', file);
  const qs = sectionId != null ? `?section_id=${encodeURIComponent(sectionId)}` : '';
  const res = await fetch(`${BASE}/media${qs}`, {
    method: 'POST',
    credentials: 'include',
    headers: token ? { 'X-CSRF-Token': token } : {},
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}
