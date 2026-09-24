// Admin orders API client — list/search, detail, status + tag updates.
import { getCSRFToken } from './auth.js';

async function csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function fetchOrders(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v) qs.set(k, v); }
  const url = '/api/v1/admin/shop/orders' + (qs.toString() ? `?${qs}` : '');
  const res  = await fetch(url, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load orders');
  return data; // { orders, total }
}

// Combined delivery-note PDF URL for a set of order ids (opened in a new tab so
// the whole batch prints in one job).
export function bulkDeliveryNotesUrl(ids) {
  const list = (ids || []).map(encodeURIComponent).join(',');
  return `/api/v1/admin/shop/orders/bulk/delivery-notes.pdf?ids=${list}`;
}

export async function fetchOrder(id) {
  const res  = await fetch('/api/v1/admin/shop/orders/' + id, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load order');
  return data; // { order, items }
}

export async function setOrderStatuses(id, body) {
  const res  = await fetch(`/api/v1/admin/shop/orders/${id}/status`, {
    method: 'PATCH', credentials: 'include', headers: await csrfHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data.order;
}

export async function setOrderTags(id, tags) {
  const res  = await fetch(`/api/v1/admin/shop/orders/${id}/tags`, {
    method: 'PATCH', credentials: 'include', headers: await csrfHeaders(), body: JSON.stringify({ tags }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data.order;
}

// Shared badge helpers (used by the list + detail views) — fall back to the raw
// value if a label key is missing so a new enum value never renders blank.
export function paymentBadge(t, status) {
  const s = status || 'pending';
  return `<span class="ord-badge ord-badge--pay-${s}">${t('orderPayment.' + s)}</span>`;
}
export function fulfillmentBadge(t, status) {
  const s = status || 'unfulfilled';
  return `<span class="ord-badge ord-badge--ful-${s}">${t('orderFulfillment.' + s)}</span>`;
}

// Every order matching the list's filters as a real .xlsx workbook, built on
// the server (GET /orders/export.xlsx — services/orderExport.js). Fetched, not a
// plain link, so a refusal (413: too many rows) arrives as an error the page can
// show instead of a saved JSON "workbook".
export async function downloadOrdersXlsx(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v) qs.set(k, v); }
  const res = await fetch('/api/v1/admin/shop/orders/export.xlsx' + (qs.toString() ? `?${qs}` : ''), { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to export orders');
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const filename = (disposition.match(/filename="([^"]+)"/) || [])[1] || 'orders.xlsx';
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a beat: Safari and older Firefox cancel a download whose URL
  // is revoked straight after click() (ice #325 review).
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
