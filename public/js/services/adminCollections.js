// Admin collections API client — list / create / update product collections.
import { getCSRFToken } from './auth.js';

async function csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function listCollections() {
  const res  = await fetch('/api/v1/admin/shop/collections', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load collections');
  return data.collections || [];
}

export async function createCollection(body) {
  const res  = await fetch('/api/v1/admin/shop/collections', {
    method: 'POST', credentials: 'include', headers: await csrfHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Create failed');
  return data.collection;
}

export async function updateCollection(id, body) {
  const res  = await fetch('/api/v1/admin/shop/collections/' + id, {
    method: 'PATCH', credentials: 'include', headers: await csrfHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data.collection;
}
