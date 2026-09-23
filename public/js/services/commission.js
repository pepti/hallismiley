// Commission report client (admin view 'commission'; a seller sees only their
// own rows, admin sees every seller). Read-only.
const BASE = '/api/v1/admin/commission';

function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// { rows, events, scope, from, to }
export async function getCommission(params) {
  const res  = await fetch(BASE + qs(params), { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load commission');
  return data;
}

export function commissionCsvUrl(params) { return `${BASE}/export.csv${qs(params)}`; }

// Admin-only staff audit log (Admin → Monitoring).
export async function getStaffAudit(params) {
  const res  = await fetch('/api/v1/admin/audit' + qs(params), { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load audit log');
  return data;
}

// ── Settlement (migration 102; D-019) ────────────────────────────────────────
// Reads are scoped on the server — a foreign statement id answers 404, never
// 403 — and every write below is admin-only there. The client never re-derives
// any of that; it only hides controls a seller cannot use.

async function send(method, url, body) {
  const { getCSRFToken } = await import('./auth.js');
  const token = await getCSRFToken();
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '');
  return data;
}

export async function getStatements() {
  const res = await fetch(`${BASE}/statements`, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '');
  return data;
}

export async function getStatement(id) {
  const res = await fetch(`${BASE}/statements/${encodeURIComponent(id)}`, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '');
  return data;
}

export function previewStatement(body)  { return send('POST', `${BASE}/statements/preview`, body); }
export function createStatement(body)   { return send('POST', `${BASE}/statements`, body); }
export function recordPayout(id, body)  { return send('POST', `${BASE}/statements/${encodeURIComponent(id)}/payouts`, body); }
export function recordAdjustment(body)  { return send('POST', `${BASE}/adjustments`, body); }
