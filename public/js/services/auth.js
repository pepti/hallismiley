// Auth service — cookie-based session auth backed by Lucia on the server.
// The auth_session cookie is httpOnly (set/cleared by the server only).
// No tokens are stored in the browser — session state lives in the DB.

let _user = null; // cached user info from last successful session check
let _csrfToken = null;

function _dispatch() {
  window.dispatchEvent(new CustomEvent('authchange', { detail: { authenticated: isAuthenticated() } }));
}

export function getUser()         { return _user; }
export function isAuthenticated() { return !!_user; }
export function hasRole(role)     { return _user?.role === role; }
export function isAdmin()         { return _user?.role === 'admin'; }
// Editor = admin or moderator. Used to gate edit-mode UI for site content
// (party page, news, projects) where moderators have full edit/delete rights.
export function canEdit()         { return _user?.role === 'admin' || _user?.role === 'moderator'; }

// Merge a partial update into the cached user (e.g. after flipping party_access
// via invite-code redemption). Dispatches authchange so listeners re-render.
export function updateCachedUser(partial) {
  if (!_user) return;
  _user = { ..._user, ...partial };
  _dispatch();
}

// ── CSRF ──────────────────────────────────────────────────────────────────────

export async function getCSRFToken() {
  if (_csrfToken) return _csrfToken;
  try {
    const res  = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    const data = await res.json();
    _csrfToken = data.token;
    return _csrfToken;
  } catch {
    return null;
  }
}

async function _csrfHeaders() {
  const token = await getCSRFToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-CSRF-Token': token } : {}),
  };
}

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
  _csrfToken = null; // refresh CSRF after login
  _dispatch();
  return data;
}

export async function logout() {
  _user = null;
  _csrfToken = null;
  const headers = await _csrfHeaders();
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

export async function resendVerification(email) {
  const res = await fetch('/auth/resend-verification', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ email }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
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
  const res  = await fetch(`/auth/check-username/${encodeURIComponent(username)}`, { credentials: 'include' });
  const data = await res.json();
  return data; // { available: bool }
}

export async function checkEmail(email) {
  const res  = await fetch(`/auth/check-email/${encodeURIComponent(email)}`, { credentials: 'include' });
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
  const headers = await _csrfHeaders();
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

export async function uploadAvatar(file) {
  const token = await getCSRFToken();
  const fd    = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/v1/users/me/avatar', {
    method:      'POST',
    credentials: 'include',
    headers:     token ? { 'X-CSRF-Token': token } : {},
    body:        fd,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Avatar upload failed');
  // Refresh cached user so NavBar picks up the new avatar
  _user = { ..._user, avatar: data.avatar };
  _dispatch();
  return data;
}

export async function changePassword(currentPassword, newPassword) {
  const headers = await _csrfHeaders();
  const res = await fetch('/api/v1/users/me/password', {
    method:      'PATCH',
    credentials: 'include',
    headers,
    body:        JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
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
  const headers = await _csrfHeaders();
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
  const headers = await _csrfHeaders();
  const res = await fetch('/api/v1/users/me/sessions', {
    method:      'DELETE',
    credentials: 'include',
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to revoke sessions');
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
  // Dispatches to the correct sub-path based on which field is being updated.
  const headers = await _csrfHeaders();
  const pathByField = {
    role:         'role',
    disabled:     'disable',
    party_access: 'party-access',
  };
  const [field] = Object.keys(updates);
  const sub = pathByField[field];
  if (!sub) throw new Error(`Unsupported admin update: ${field}`);

  const res = await fetch(`/api/v1/admin/users/${userId}/${sub}`, {
    method:      'PATCH',
    credentials: 'include',
    headers,
    body:        JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data;
}

export async function adminDeleteUser(userId) {
  const headers = await _csrfHeaders();
  const res = await fetch(`/api/v1/admin/users/${userId}`, {
    method:      'DELETE',
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Delete failed');
  }
}
