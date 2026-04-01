// Auth service — cookie-based session auth backed by Lucia on the server.
// The auth_session cookie is httpOnly (set/cleared by the server only).
// No tokens are stored in the browser — session state lives in the DB.

import { getCSRFToken, clearCSRFToken, getCsrfHeaders } from '../utils/api.js';

export { getCSRFToken };

let _user = null; // cached user info from last successful session check

function _dispatch() {
  window.dispatchEvent(new CustomEvent('authchange', { detail: { authenticated: isAuthenticated() } }));
}

export function getUser()         { return _user; }
export function isAuthenticated() { return !!_user; }
export function hasRole(role)     { return _user?.role === role; }
export function isAdmin()         { return _user?.role === 'admin'; }

// ── Session ───────────────────────────────────────────────────────────────────

export async function login(username, password) {
  const res  = await fetch('/auth/login', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  _user = data.user;
  clearCSRFToken(); // refresh CSRF after login
  _dispatch();
  return data;
}

export async function logout() {
  _user = null;
  clearCSRFToken();
  const headers = await getCsrfHeaders();
  await fetch('/auth/logout', { method: 'POST', credentials: 'include', headers }).catch(() => {});
  _dispatch();
}

export async function tryRestoreSession() {
  try {
    const res  = await fetch('/auth/session', { credentials: 'include' });
    const data = await res.json();
    if (data.authenticated) {
      _user = data.user;
      _dispatch();
    }
  } catch { /* no session or network error — that's fine */ }
}

// ── Registration & email ──────────────────────────────────────────────────────

export async function signup(data) {
  const res = await fetch('/auth/signup', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Signup failed');
  return body;
}

export async function verifyEmail(token) {
  const res = await fetch('/auth/verify-email', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ token }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Verification failed');
  return body;
}

export async function forgotPassword(email) {
  const res = await fetch('/auth/forgot-password', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ email }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export async function resetPassword(token, password) {
  const res = await fetch('/auth/reset-password', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ token, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Reset failed');
  return body;
}

// ── Availability checks (debounced by callers) ────────────────────────────────

export async function checkUsername(username) {
  const res  = await fetch(`/auth/check-username?username=${encodeURIComponent(username)}`, { credentials: 'include' });
  const data = await res.json();
  return data; // { available: bool }
}

export async function checkEmail(email) {
  const res  = await fetch(`/auth/check-email?email=${encodeURIComponent(email)}`, { credentials: 'include' });
  const data = await res.json();
  return data; // { available: bool }
}

// ── Profile ───────────────────────────────────────────────────────────────────

export async function getProfile() {
  const res  = await fetch('/api/v1/users/me', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load profile');
  return data;
}

export async function updateProfile(updates) {
  const headers = await getCsrfHeaders();
  const res = await fetch('/api/v1/users/me', {
    method:      'PATCH',
    credentials: 'include',
    headers,
    body:        JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  if (data.user) { _user = data.user; _dispatch(); }
  return data;
}

export async function changePassword(currentPassword, newPassword) {
  const headers = await getCsrfHeaders();
  const res = await fetch('/api/v1/users/me/password', {
    method:      'POST',
    credentials: 'include',
    headers,
    body:        JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Password change failed');
  return data;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function getSessions() {
  const res  = await fetch('/api/v1/users/me/sessions', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load sessions');
  return data;
}

export async function revokeSession(sessionId) {
  const headers = await getCsrfHeaders();
  const res = await fetch(`/api/v1/users/me/sessions/${sessionId}`, {
    method:      'DELETE',
    credentials: 'include',
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to revoke session');
  return data;
}

export async function revokeAllSessions() {
  const headers = await getCsrfHeaders();
  const res = await fetch('/api/v1/users/me/sessions', {
    method:      'DELETE',
    credentials: 'include',
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to revoke sessions');
  return data;
}

// ── Favorites ─────────────────────────────────────────────────────────────────

export async function getFavorites() {
  const res  = await fetch('/api/v1/users/me/favorites', { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load favorites');
  return data;
}

export async function addFavorite(projectId) {
  const headers = await getCsrfHeaders();
  const res = await fetch(`/api/v1/users/me/favorites/${projectId}`, {
    method:      'POST',
    credentials: 'include',
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to add favorite');
  return data;
}

export async function removeFavorite(projectId) {
  const headers = await getCsrfHeaders();
  const res = await fetch(`/api/v1/users/me/favorites/${projectId}`, {
    method:      'DELETE',
    credentials: 'include',
    headers,
  });
  if (res.status === 204) return;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to remove favorite');
  return data;
}

// ── Public profile ────────────────────────────────────────────────────────────

export async function getPublicProfile(username) {
  const res  = await fetch(`/api/v1/users/${encodeURIComponent(username)}/profile`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'User not found');
  return data;
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function adminGetUsers(params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`/api/v1/admin/users${qs ? '?' + qs : ''}`, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load users');
  return data;
}

export async function adminUpdateUser(userId, updates) {
  const headers = await getCsrfHeaders();
  const res = await fetch(`/api/v1/admin/users/${userId}`, {
    method:      'PATCH',
    credentials: 'include',
    headers,
    body:        JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data;
}
