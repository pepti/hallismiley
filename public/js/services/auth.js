// Auth service — access token stored in memory only (never localStorage/sessionStorage)
// Refresh token lives in httpOnly cookie, handled automatically by the browser

let _accessToken  = null;
let _refreshTimer = null;

const ACCESS_TTL = 15 * 60 * 1000; // 15 min in ms
const REFRESH_BUFFER = 60 * 1000;  // refresh 1 min before expiry

function _dispatch() {
  window.dispatchEvent(new CustomEvent('authchange', { detail: { authenticated: isAuthenticated() } }));
}

function _scheduleRefresh() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(async () => {
    try { await refresh(); } catch { logout(); }
  }, ACCESS_TTL - REFRESH_BUFFER);
}

export function getToken()        { return _accessToken; }
export function isAuthenticated() { return !!_accessToken; }

export async function login(username, password) {
  const res  = await fetch('/auth/login', {
    method: 'POST',
    credentials: 'include', // include cookies for refresh token
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');

  _accessToken = data.access_token;
  _scheduleRefresh();
  _dispatch();
  return data;
}

export async function refresh() {
  const res  = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Session expired');

  _accessToken = data.access_token;
  _scheduleRefresh();
  _dispatch();
  return data;
}

export async function logout() {
  clearTimeout(_refreshTimer);
  _accessToken = null;
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  _dispatch();
}

// On page load — try to restore session from refresh token cookie silently
export async function tryRestoreSession() {
  try { await refresh(); } catch { /* no session — that's fine */ }
}
