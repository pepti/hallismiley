// Markaður API client (admin view 'markadur'). Reads for any role holding the
// view; the status hand-off is admin/moderator on the server and sends CSRF.
import { getCSRFToken } from './auth.js';

const BASE = '/api/v1/admin/markadur';

function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
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

// { companies, total, page, limit, sort, dir, filters }
export function getCompanies(params) { return getJSON(BASE + qs(params), 'Failed to load companies'); }
// { company: { ..., financials: [...] } }
export function getCompany(id)       { return getJSON(`${BASE}/${encodeURIComponent(id)}`, 'Company not found'); }

export async function setCompanyStatus(id, status) {
  const token = await getCSRFToken();
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}/status`, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body: JSON.stringify({ status }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Status change failed');
  return data;
}
