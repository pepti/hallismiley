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
