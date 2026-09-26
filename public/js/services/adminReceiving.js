// Goods receiving API client (admin view 'receiving'; harvest2-lane6a-2026-09-26,
// after icelandicstore's services/adminGoodsReceipt.js). Every write answers
// with the receipt's whole state ({ receipt, lines, extras, scans, summary }),
// so the page re-renders from one shape. Errors carry .status/.reason/.lines.
import { getCSRFToken } from './auth.js';
import { getCsrfHeaders } from '../utils/api.js';

const BASE = '/api/v1/admin/receiving';

async function call(url, { method = 'GET', body, form, fallback } = {}) {
  const init = { method, credentials: 'include' };
  if (form) {
    const token = await getCSRFToken();
    init.headers = token ? { 'X-CSRF-Token': token } : {};
    init.body = form;
  } else if (body !== undefined || method !== 'GET') {
    init.headers = await getCsrfHeaders();
    init.body = JSON.stringify(body || {});
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || fallback || 'Request failed');
    err.status = res.status;
    err.reason = data.reason || null;
    err.lines = Array.isArray(data.lines) ? data.lines : null;
    err.lineIds = Array.isArray(data.lineIds) ? data.lineIds : null;
    throw err;
  }
  return data;
}

const id = (v) => encodeURIComponent(String(v));

export async function listReceipts(status = null) {
  const data = await call(BASE + (status ? '?status=' + encodeURIComponent(status) : ''));
  return data.receipts || [];
}
export function createReceipt(body)          { return call(BASE, { method: 'POST', body }); }
export function getReceipt(receiptId)        { return call(`${BASE}/${id(receiptId)}`); }
export function importLines(receiptId, file) {
  const form = new FormData();
  form.append('file', file);
  return call(`${BASE}/${id(receiptId)}/lines/import`, { method: 'POST', form });
}
export function updateLine(receiptId, lineId, body) {
  return call(`${BASE}/${id(receiptId)}/lines/${id(lineId)}`, { method: 'PATCH', body });
}
export function scan(receiptId, code, qty = 1) {
  return call(`${BASE}/${id(receiptId)}/scan`, { method: 'POST', body: { code, qty } });
}
export function deleteScan(receiptId, scanId) {
  return call(`${BASE}/${id(receiptId)}/scans/${id(scanId)}`, { method: 'DELETE' });
}
export function finalizeReceipt(receiptId, excludeExtras = []) {
  return call(`${BASE}/${id(receiptId)}/finalize`, { method: 'POST', body: { excludeExtras } });
}
export function cancelReceipt(receiptId)     { return call(`${BASE}/${id(receiptId)}/cancel`, { method: 'POST' }); }
export function receiptPdfUrl(receiptId)     { return `${BASE}/${id(receiptId)}/receipt.pdf`; }
// The line matcher's picker (stocked units only) — behind the receiving view.
export async function searchItems(q) {
  const data = await call(`${BASE}/search?q=${encodeURIComponent(q)}`);
  return data.items || [];
}
