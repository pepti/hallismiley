// Admin discount API client — list / create / update code-based discounts.
import { getCSRFToken } from './auth.js';

async function csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function listDiscounts() {
  const res  = await fetch('/api/v1/admin/discounts', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load discounts');
  return data.discounts || [];
}

export async function createDiscount(body) {
  const res  = await fetch('/api/v1/admin/discounts', {
    method: 'POST', credentials: 'include', headers: await csrfHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Create failed');
  return data.discount;
}

export async function updateDiscount(id, body) {
  const res  = await fetch('/api/v1/admin/discounts/' + id, {
    method: 'PATCH', credentials: 'include', headers: await csrfHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data.discount;
}
