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
