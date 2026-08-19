// Auth service — cookie-based session auth backed by Lucia on the server.
// The auth_session cookie is httpOnly (set/cleared by the server only).
// No tokens are stored in the browser — session state lives in the DB.

let _user = null; // cached user info from last successful session check
let _csrfToken = null;

// `reason: 'login'` marks the transitions where the user deliberately signed in
// on this page (password login, party magic link, post-signup Continue) as
// opposed to a session simply being restored on page load. cart.js uses it to
// decide whether a guest basket should be folded into the account's basket.
function _dispatch(reason = null) {
  window.dispatchEvent(new CustomEvent('authchange', {
    detail: { authenticated: isAuthenticated(), reason },
  }));
}

export function getUser()         { return _user; }
export function isAuthenticated() { return !!_user; }
// Multi-role: a user holds a SET of roles (user.roles); fall back to the single
// primary (user.role) for safety / older session payloads.
export function getRoles()        { return _user?.roles || (_user?.role ? [_user.role] : []); }
export function hasRole(role)     { return getRoles().includes(role); }
export function isAdmin()         { return getRoles().includes('admin'); }
// Editor = admin or moderator. Used to gate edit-mode UI for site content
// (party page, news, projects) where moderators have full edit/delete rights.
export function canEdit()         { return getRoles().some(r => r === 'admin' || r === 'moderator'); }

// ── Admin view access (RBAC) ────────────────────────────────────────────────
// The session payload carries the resolved admin-view id list ('*' = all).
// These gate the admin sidebar + router for UX; the server enforces them too.
export function getViews()        { return _user?.views || []; }
export function canSeeView(id)    { const v = getViews(); return v.includes('*') || v.includes(id); }
export function hasAnyAdminView() { return getViews().length > 0; }

// Merge a partial update into the cached user (e.g. after a profile change).
// Dispatches authchange so listeners re-render.
//
// `silent` skips that dispatch — for fields no view derives anything from. The
// router re-navigates on every authchange, so a silent merge is the difference
// between "keep the cache honest" and "rebuild the page the user is using".
// Saving a theme is exactly that case: the change is already painted via the
// <html data-theme> attribute, and a re-render would discard the open view.
export function updateCachedUser(partial, { silent = false } = {}) {
  if (!_user) return;
  _user = { ..._user, ...partial };
  if (!silent) _dispatch();
}

// Drop the cached session WITHOUT a network call — used by the global 401 guard
// when the server reports the session is gone (expired, or the auth_session
// cookie was dropped when the browser closed). Mirrors logout()'s local effect
// so the UI flips to logged-out and route guards fire.
export function clearSession() {
  _user = null;
  _csrfToken = null;
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
  // A protected account (admin with 2FA) gets a challenge instead of a session.
  // Return it WITHOUT touching _user: nothing is signed in yet, and treating this
  // as a login would put the SPA into a logged-in state the server disagrees with.
  if (data.mfaRequired) return data;
  _user = data.user;
  _csrfToken = null; // refresh CSRF after login
  _dispatch('login');
  return data;
}

/**
 * Step two of a protected sign-in: exchange the challenge + code for a session.
 * `code` is a 6-digit authenticator code or a single-use recovery code — the
 * server works out which, so the UI doesn't have to ask.
 */
export async function loginTotp(challengeId, code) {
  const res = await fetch('/auth/login/totp', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ challengeId, code }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Verification failed');
    err.attemptsRemaining = data.attemptsRemaining;
    // These mean the challenge is gone — the UI must send the user back to the
    // password step rather than let them keep typing codes at a dead challenge.
    err.restart = res.status === 401 && typeof data.attemptsRemaining !== 'number';
    throw err;
  }
  _user = data.user;
  _csrfToken = null;
  // Completing the challenge IS the deliberate sign-in — same reason as login().
  _dispatch('login');
  return data;
}

// Magic-link login for party guests. Consumes a non-expiring token from the
// invite email and mints a normal Lucia session, exactly like login().
export async function partyMagicLogin(token) {
  const res  = await fetch('/auth/party-magic-login', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Sign-in failed');
  _user = data.user;
  _csrfToken = null; // refresh CSRF after login
  _dispatch('login');
  return data;
}

export async function logout() {
  _csrfToken = null; // force a fresh CSRF token for the logout POST
  const headers = await _csrfHeaders();
  await fetch('/auth/logout', { method: 'POST', credentials: 'include', headers }).catch(() => {});
  // Cleared only once the round-trips are done and we're about to notify
  // listeners. Clearing it first would flip the per-account cart key to ::guest
  // while the UI still showed the signed-in basket, so a qty change or remove
  // during that window wrote the ex-user's lines into the guest basket.
  _user = null;
  _dispatch();
}

export async function tryRestoreSession() {
  try {
    const res  = await fetch('/auth/session', { credentials: 'include', cache: 'no-store' });
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
  // Cache the user silently — the welcome screen wants to stay rendered.
  // Dispatching authchange here would cause the router (which listens on it)
  // to re-render SignupView and wipe the success panel. SignupView fires
  // authchange itself once the user clicks Continue and leaves the page.
  if (body.user) {
    _user = body.user;
    _csrfToken = null;
  }
  return body;
}

/** Notify the app that auth state changed. Used by SignupView to sync the
 *  NavBar after the user clicks Continue from the welcome screen. */
export function notifyAuthChange() {
  _dispatch('login');
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
  if (!res.ok) {
    const err = new Error(data.error || 'Update failed');
    err.status = res.status;
    throw err;
  }
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

// ── Two-step verification (admin) ─────────────────────────────────────────────

/** Begin enrolment. Returns { secret, uri, qr } — shown once, for the app or manual entry. */
export async function totpSetup() {
  const headers = await _csrfHeaders();
  const res = await fetch('/auth/totp/setup', { method: 'POST', credentials: 'include', headers, body: '{}' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not start set-up');
  return data;
}

/** Confirm with a code from the app. Returns { enabled, recoveryCodes } — the codes appear ONCE. */
export async function totpConfirm(code) {
  const headers = await _csrfHeaders();
  const res = await fetch('/auth/totp/confirm', {
    method: 'POST', credentials: 'include', headers, body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not confirm');
  updateCachedUser({ totp_enabled: true });
  return data;
}

/** Turn it off. Requires the account password. */
export async function totpDisable(password) {
  const headers = await _csrfHeaders();
  const res = await fetch('/auth/totp/disable', {
    method: 'POST', credentials: 'include', headers, body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not turn off');
  updateCachedUser({ totp_enabled: false });
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

// Approve / decline a pending party guest. On approve the server emails the
// guest their magic link; both return the updated user row.
export async function adminApproveUser(userId, action = 'approve') {
  const sub     = action === 'decline' ? 'decline' : 'approve';
  const headers = await _csrfHeaders();
  const res = await fetch(`/api/v1/admin/users/${userId}/${sub}`, {
    method:      'PATCH',
    credentials: 'include',
    headers,
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
