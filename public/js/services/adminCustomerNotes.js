// Admin customer-notes service — staff-authored notes ABOUT a shop customer
// (order preferences, how they order, special needs, general). Owner is
// { customerId }. Gated by the 'customers' view; the server enforces per-note
// visibility ('admin' vs 'staff').
import { getCSRFToken } from './auth.js';

async function _csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function listCustomerNotes(customerId) {
  const res  = await fetch(`/api/v1/admin/customer-notes?customerId=${encodeURIComponent(customerId)}`, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) { const e = new Error(data.error || 'Failed to load notes'); e.status = res.status; throw e; }
  return data; // { notes }
}

// payload: { customerId, category, body, visibility? }
export async function createCustomerNote(payload) {
  const headers = await _csrfHeaders();
  const res = await fetch('/api/v1/admin/customer-notes', {
    method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save note');
  return data; // { note }
}

export async function updateCustomerNote(id, fields) {
  const headers = await _csrfHeaders();
  const res = await fetch(`/api/v1/admin/customer-notes/${encodeURIComponent(id)}`, {
    method: 'PATCH', credentials: 'include', headers, body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update note');
  return data; // { note }
}

export async function deleteCustomerNote(id) {
  const headers = await _csrfHeaders();
  const res = await fetch(`/api/v1/admin/customer-notes/${encodeURIComponent(id)}`, {
    method: 'DELETE', credentials: 'include', headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete note');
  return data; // { ok:true }
}
