// Leads inbox API client (admin view 'leads'). Reads and the workflow writes
// (status / note / owner) are available to any role holding the view; delete
// and the CSV export are admin-only on the server.
import { getCSRFToken } from './auth.js';

const BASE = '/api/v1/admin/leads';

async function csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
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

// { leads, total, counts, page, limit, statuses, retentionDays }
export function getLeads(params)        { return getJSON(BASE + qs(params), 'Failed to load leads'); }
export function getLead(id)             { return getJSON(`${BASE}/${encodeURIComponent(id)}`, 'Lead not found'); }
export function updateLead(id, body)    { return sendJSON('PATCH', `${BASE}/${encodeURIComponent(id)}`, body, 'Update failed'); }
export function deleteLead(id)          { return sendJSON('DELETE', `${BASE}/${encodeURIComponent(id)}`, undefined, 'Delete failed'); }
export function leadsCsvUrl(params)     { return `${BASE}/export.csv${qs(params)}`; }
