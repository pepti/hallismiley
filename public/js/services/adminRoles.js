// Admin roles API client — list / create / update / delete dynamic roles.
import { getCSRFToken } from './auth.js';

async function csrfHeaders() {
  const token = await getCSRFToken();
  return { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) };
}

export async function listRoles() {
  const res  = await fetch('/api/v1/admin/roles', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load roles');
  return data; // { roles, grantableViews }
}

export async function createRole(body) {
  const res  = await fetch('/api/v1/admin/roles', {
    method: 'POST', credentials: 'include', headers: await csrfHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Create failed');
  return data.role;
}

export async function updateRole(name, body) {
  const res  = await fetch('/api/v1/admin/roles/' + encodeURIComponent(name), {
    method: 'PATCH', credentials: 'include', headers: await csrfHeaders(), body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data.role;
}

export async function deleteRole(name) {
  const res = await fetch('/api/v1/admin/roles/' + encodeURIComponent(name), {
    method: 'DELETE', credentials: 'include', headers: await csrfHeaders(),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Delete failed');
  }
}
