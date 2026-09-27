// Admin products API client — CSV catalogue export + import round-trip.
import { getCSRFToken } from './auth.js';
import { getCsrfHeaders } from '../utils/api.js';

// Direct download URL (the response carries Content-Disposition: attachment).
export function adminExportProductsUrl() {
  return '/api/v1/admin/shop/products/export.csv';
}

// Upload ONE product file (.csv / .xlsx / .pdf) to be read on the server
// (services/productImport) → { source, rows, headers, ignored,
// orderQtyColumns, importableFields, truncated }. Multipart, so no JSON header.
export async function adminParseProductImportFile(file) {
  const token = await getCSRFToken();
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/v1/admin/shop/products/import/parse-file', {
    method: 'POST', credentials: 'include',
    headers: token ? { 'X-CSRF-Token': token } : {},
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not read that file');
  return data;
}

// Read-only classification of parsed rows → { counts, createProducts, rows }.
// `create` also plans the products the file's variant rows would create.
export async function adminPreviewProductImport(rows, { create = false } = {}) {
  const res = await fetch('/api/v1/admin/shop/products/import/preview', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ rows, create }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Preview failed');
  return data;
}

// Apply the import → { updated, created, createdVariants, skipped, failed, total }.
export async function adminApplyProductImport(rows, { create = false } = {}) {
  const token = await getCSRFToken();
  const res = await fetch('/api/v1/admin/shop/products/import/apply', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body:        JSON.stringify({ rows, create }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Import failed');
  return data;
}

// POST /products/bulk — action 'activate' | 'deactivate' | 'edit' (with
// `fields`: category, subcategory, vat_rate, active, bin — blank = leave as is).
export async function adminBulkProducts(ids, action, fields = undefined) {
  const headers = await getCsrfHeaders();
  const res = await fetch('/api/v1/admin/shop/products/bulk', {
    method: 'POST', credentials: 'include', headers,
    body: JSON.stringify(fields ? { ids, action, fields } : { ids, action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bulk action failed');
  return data; // { updated }
}

// GET /products/:id/adjustments — the product's stock audit trail, newest first.
export async function adminProductAdjustments(id, { limit = 50 } = {}) {
  const res = await fetch(`/api/v1/admin/shop/products/${encodeURIComponent(id)}/adjustments?limit=${limit}`, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load stock history');
  return data; // { adjustments }
}

// ── "Read with AI" in the import (dark by default; ice #306/#314) ────────────

// GET /products/import/ai-config → { enabled, chunkPages, maxPages, maxFilePages, remainingPages }.
export async function adminProductImportAiConfig() {
  try {
    const res = await fetch('/api/v1/admin/shop/products/import/ai-config', { credentials: 'include' });
    if (!res.ok) return { enabled: false };
    return await res.json();
  } catch {
    return { enabled: false };
  }
}

// POST /products/import/ai-extract?from=&to= with ONE PDF chunk → { rows, from,
// to, pages, truncated, remainingPages, summary }. A failure throws an Error
// carrying .status, .reason and .retryAfter (seconds) for utils/aiPdfChunks.js.
export async function adminProductImportAiExtract(blob, { from, to, signal } = {}) {
  const token = await getCSRFToken();
  const fd = new FormData();
  fd.append('file', blob, `pages-${from}-${to}.pdf`);
  const res = await fetch(`/api/v1/admin/shop/products/import/ai-extract?from=${Number(from)}&to=${Number(to)}`, {
    method: 'POST', credentials: 'include', headers: token ? { 'X-CSRF-Token': token } : {}, body: fd, signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `AI read failed (${res.status})`);
    e.status = res.status;
    e.reason = data.reason || null;
    const ra = res.headers.get('Retry-After');
    e.retryAfter = ra == null || ra === '' ? null : Number(ra);
    throw e;
  }
  return data;
}

// ── Products → Duplicates and the merge (migration 120, ice #309/#311/#312) ──

// An Error carrying the envelope's code/reason/refusals, so the screen can say
// WHY a merge was refused and re-plan on a stale preview.
function mergeFailure(res, data, fallback) {
  const e = new Error(data.error || fallback);
  e.status = res.status;
  e.reason = data.reason || null;
  e.refusals = Array.isArray(data.refusals) ? data.refusals : [];
  return e;
}

// GET /products/duplicates → { groups } (read-only suggestions + evidence).
export async function adminGetProductDuplicates() {
  const res = await fetch('/api/v1/admin/shop/products/duplicates', { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw mergeFailure(res, data, 'Failed to load duplicates');
  return data;
}

// POST /products/merge/preview { master, ids, variant_map? } → the plan,
// `request` and `expect` (writes nothing).
export async function adminPreviewProductMerge(body, { signal } = {}) {
  const headers = await getCsrfHeaders();
  const res = await fetch('/api/v1/admin/shop/products/merge/preview', {
    method: 'POST', credentials: 'include', headers, body: JSON.stringify(body), signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw mergeFailure(res, data, 'Preview failed');
  return data;
}

// POST /products/merge { …request, expect } → { mergeIds, masterId, merged, counts, summary }.
export async function adminMergeProducts(body) {
  const headers = await getCsrfHeaders();
  const res = await fetch('/api/v1/admin/shop/products/merge', {
    method: 'POST', credentials: 'include', headers, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw mergeFailure(res, data, 'Merge failed');
  return data;
}
