// Bókhald API client.
//
// Reads pass query params straight through; the server validates and returns a
// 400 with an explanation rather than silently coercing, so an error thrown here
// carries a message worth showing the user verbatim.
import { getCSRFToken } from './auth.js';

const BASE = '/api/v1/admin/bookkeeping';

async function csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

async function get(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    // Keep 0 and false; drop only genuinely absent values.
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  }
  const res = await fetch(BASE + path + (qs.toString() ? `?${qs}` : ''), { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Beiðni mistókst');
  return data;
}

async function send(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: await csrfHeaders(),
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Beiðni mistókst');
  return data;
}

export const fetchDashboard = (params) => get('/dashboard', params);
export const fetchInvoices = (params) => get('/invoices', params);
export const fetchInvoice = (id) => get(`/invoices/${encodeURIComponent(id)}`);
export const fetchBooksSettings = () => get('/settings');

export const updateBooksSettings = (patch) => send('PATCH', '/settings', patch);
export const setFxRate = (body) => send('POST', '/fx-rates', body);

export const issueInvoiceForOrder = (orderId) =>
  send('POST', `/invoices/from-order/${encodeURIComponent(orderId)}`, {});

// The idempotency key is generated per attempt by the CALLER, not here, so that a
// retry of a failed submit reuses the same key and cannot double-book the payment.
export const recordPayment = (invoiceId, body) =>
  send('POST', `/invoices/${encodeURIComponent(invoiceId)}/payments`, body);

export const issueCreditNote = (invoiceId, body) =>
  send('POST', `/invoices/${encodeURIComponent(invoiceId)}/credit-notes`, body);

export const invoicePdfUrl = (id) => `${BASE}/invoices/${encodeURIComponent(id)}/pdf`;

// crypto.randomUUID is available in every browser this app supports; the fallback
// keeps a non-secure-context dev server working.
export function newIdempotencyKey() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
