// Inventory Watch + stock count API client (admin view 'inventory';
// harvest2-lane6a-2026-09-26, after icelandicstore's services/adminInventory.js
// and adminScan.js). Reads return the controller's JSON; writes send CSRF.
// A failed call throws an Error carrying the envelope: .status, .reason and,
// for a refused batch, .lines (one entry per refused line).
import { getCsrfHeaders } from '../utils/api.js';

async function call(url, { method = 'GET', body, fallback } = {}) {
  const init = { method, credentials: 'include' };
  if (body !== undefined) {
    init.headers = await getCsrfHeaders();
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || fallback || 'Request failed');
    err.status = res.status;
    err.reason = data.reason || null;
    err.lines = Array.isArray(data.lines) ? data.lines : null;
    err.line = data.line || null;
    throw err;
  }
  return data;
}

// → { items, counts, total, window_days }
export async function getInventoryReport() {
  const data = await call('/api/v1/admin/shop/reports/inventory');
  return data.report;
}

// { productId, variantId?, stock, reason, note? } → { previous, stock, delta, adjustmentId, item }
export function correctStock(body) {
  return call('/api/v1/admin/inventory/stock', { method: 'PATCH', body });
}

// → { items, variantRequired }
export function lookupCode(code) {
  return call('/api/v1/admin/inventory/lookup?code=' + encodeURIComponent(code));
}

// → items
export async function searchItems(q) {
  const data = await call('/api/v1/admin/inventory/search?q=' + encodeURIComponent(q));
  return data.items || [];
}

// { lines: [{ productId, variantId?, mode, qty }], reason?, note?, clientToken } → { batchId, results }
export function saveCount(body) {
  return call('/api/v1/admin/inventory/count', { method: 'POST', body });
}
