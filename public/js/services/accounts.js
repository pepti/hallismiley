// Customer accounts API client (admin view 'accounts'; row-scoped on the
// server — a seller only ever sees their own). The owner change is admin-only;
// the service invoice is admin-only and lives under the bookkeeping API.
import { getCSRFToken } from './auth.js';

const BASE = '/api/v1/admin/accounts';

async function csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

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

export function getAccounts(params)             { return getJSON(BASE + qs(params), 'Failed to load accounts'); }
export function getAccount(id)                  { return getJSON(`${BASE}/${encodeURIComponent(id)}`, 'Account not found'); }
export function createAccount(body)             { return sendJSON('POST', BASE, body, 'Create failed'); }
export function updateAccount(id, body)         { return sendJSON('PATCH', `${BASE}/${encodeURIComponent(id)}`, body, 'Update failed'); }
export function changeAccountOwner(id, ownerId) { return sendJSON('PATCH', `${BASE}/${encodeURIComponent(id)}/owner`, { owner_user_id: ownerId }, 'Owner change failed'); }
export function requestProvision(id)            { return sendJSON('POST', `${BASE}/${encodeURIComponent(id)}/provision-request`, {}, 'Request failed'); }
export function getAccountAudit(id)             { return getJSON(`${BASE}/${encodeURIComponent(id)}/audit`, 'Failed to load audit'); }
export function getAccountCommission(id)        { return getJSON(`${BASE}/${encodeURIComponent(id)}/commission`, 'Failed to load commission'); }

// POST /api/v1/admin/bookkeeping/invoices/service (admin) — { invoice, commission }
export function issueServiceInvoice(body) {
  return sendJSON('POST', '/api/v1/admin/bookkeeping/invoices/service', body, 'Invoice failed');
}
