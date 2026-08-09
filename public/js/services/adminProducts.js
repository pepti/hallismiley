// Admin products API client — CSV catalogue export + import round-trip.
import { getCSRFToken } from './auth.js';

// Direct download URL (the response carries Content-Disposition: attachment).
export function adminExportProductsUrl() {
  return '/api/v1/admin/shop/products/export.csv';
}

// Read-only classification of parsed CSV rows → { counts, rows }.
export async function adminPreviewProductImport(rows) {
  const res = await fetch('/api/v1/admin/shop/products/import/preview', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Preview failed');
  return data;
}

// Apply the import (existing rows only) → { updated, skipped, failed, total }.
export async function adminApplyProductImport(rows) {
  const token = await getCSRFToken();
  const res = await fetch('/api/v1/admin/shop/products/import/apply', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body:        JSON.stringify({ rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Import failed');
  return data;
}
