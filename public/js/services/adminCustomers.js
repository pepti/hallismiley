// Admin Customers API client — list + add (passwordless + invite) + CSV import.
import { getCSRFToken } from './auth.js';

export async function adminListCustomers(q = '') {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const res  = await fetch('/api/v1/admin/customers' + qs, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load customers');
  return data; // { customers, total }
}

export async function adminCreateCustomer(payload) {
  const token = await getCSRFToken();
  const res = await fetch('/api/v1/admin/customers', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body:        JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Create failed');
  return data; // { customer, invited, resetUrl }
}

export async function adminPreviewCustomerImport(rows) {
  const res = await fetch('/api/v1/admin/customers/import/preview', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Preview failed');
  return data; // { counts }
}

export async function adminDeleteCustomers(userIds) {
  const token = await getCSRFToken();
  const res = await fetch('/api/v1/admin/customers/delete', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body:        JSON.stringify({ userIds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Delete failed');
  return data; // { accounts, deletedAccounts }
}

export async function adminApplyCustomerImport(rows) {
  const token = await getCSRFToken();
  const res = await fetch('/api/v1/admin/customers/import', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body:        JSON.stringify({ rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Import failed');
  return data; // { created, total }
}
