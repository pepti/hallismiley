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

// ── One customer (harvest 2 lane 3, ported from icelandicstore #336) ─────────

async function _csrfJson() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function adminGetCustomer(id) {
  const res  = await fetch('/api/v1/admin/customers/' + encodeURIComponent(id), { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load customer');
  return data.customer; // { id, email, display_name, phone, address1…country, has_password, … }
}

// Only the keys present in `fields` are changed; '' clears a field.
export async function adminUpdateCustomer(id, fields) {
  const res = await fetch('/api/v1/admin/customers/' + encodeURIComponent(id), {
    method: 'PATCH', credentials: 'include', headers: await _csrfJson(), body: JSON.stringify(fields),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Save failed');
  return data.customer;
}

// Send (or re-send) the welcome invite. The answer says what happened — it
// never carries the set-password link.
export async function adminInviteCustomer(id) {
  const res = await fetch('/api/v1/admin/customers/' + encodeURIComponent(id) + '/invite', {
    method: 'POST', credentials: 'include', headers: await _csrfJson(), body: '{}',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Invite failed');
  return data; // { invited, emailed, redirected?, emailError? }
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

// ── Bulk welcome invites ─────────────────────────────────────────────────────

export async function adminGetInvitePreview() {
  const res  = await fetch('/api/v1/admin/customers/send-invites/preview', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load invite preview');
  return data; // { count, candidates, emailConfigured, template, defaults }
}

export async function adminRenderInvitePreview({ locale, subject, heading, body }) {
  const res = await fetch('/api/v1/admin/customers/send-invites/render', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ locale, subject, heading, body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Preview failed');
  return data.html;
}

export async function adminSaveInviteTemplate(patch) {
  const token = await getCSRFToken();
  const res = await fetch('/api/v1/admin/customers/invite-template', {
    method:      'PATCH',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body:        JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Save failed');
  return data.template;
}

export async function adminSendBulkInvites({ recipientIds } = {}) {
  const token = await getCSRFToken();
  const res = await fetch('/api/v1/admin/customers/send-invites', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
    body:        JSON.stringify(recipientIds ? { recipientIds } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Send failed');
  return data; // { sent, failed, devLinks? }
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
