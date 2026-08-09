// Admin roles API client — list / create / update / delete dynamic roles, plus
// multi-role membership management for the "Members" board.
import { getCSRFToken, adminGetUsers } from './auth.js';

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

// ── Members (multi-role membership) ─────────────────────────────────────────────

// Every role with its current members — powers the Members board.
export async function listMembers() {
  const res  = await fetch('/api/v1/admin/roles/members', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load members');
  return data; // { roles: [{ name, description, is_system, view_access, members: [...] }] }
}

// Grant a role to a user (add a membership).
export async function addMember(role, userId) {
  const res = await fetch('/api/v1/admin/roles/' + encodeURIComponent(role) + '/members', {
    method: 'POST', credentials: 'include', headers: await csrfHeaders(),
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Failed to add member');
  }
}

// Revoke a role from a user (remove a membership).
export async function removeMember(role, userId) {
  const res = await fetch(
    '/api/v1/admin/roles/' + encodeURIComponent(role) + '/members/' + encodeURIComponent(userId),
    { method: 'DELETE', credentials: 'include', headers: await csrfHeaders() }
  );
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Failed to remove member');
  }
}

// Search people in the system by name / id (username) / email for the add panel.
export async function searchUsers(q) {
  const data = await adminGetUsers({ q, limit: 20 });
  return data.users || [];
}
