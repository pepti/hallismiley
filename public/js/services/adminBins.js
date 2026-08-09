// BIN System API client — the visual warehouse-stock board (admin view 'bins').
// Reads return the controller's JSON as-is; the single write (move) sends CSRF.
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

export function getBoard()       { return getJSON('/api/v1/admin/bins/board', 'Failed to load board'); }
export function getZone(zone)    { return getJSON('/api/v1/admin/bins/zone/' + encodeURIComponent(zone), 'Failed to load zone'); }
export function getBinItems(bin) { return getJSON('/api/v1/admin/bins/' + encodeURIComponent(bin) + '/items', 'Failed to load bin'); }
export function getQueue()       { return getJSON('/api/v1/admin/bins/queue', 'Failed to load queue'); }
export function getMismatches()  { return getJSON('/api/v1/admin/bins/mismatches', 'Failed to load mismatches'); }
export function lookupCode(code) { return getJSON('/api/v1/admin/bins/lookup?code=' + encodeURIComponent(code), 'Not found'); }
export function searchBins(q)    { return getJSON('/api/v1/admin/bins/search?q=' + encodeURIComponent(q), 'Search failed'); }

export async function moveItem(body) {
  const res  = await fetch('/api/v1/admin/bins/move', {
    method: 'PATCH', credentials: 'include', headers: await csrfHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Move failed');
  return data.item;
}
