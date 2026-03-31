// Auth service — cookie-based session auth backed by Lucia on the server.
// The auth_session cookie is httpOnly (set/cleared by the server only).
// No tokens are stored in the browser — session state lives in the DB.

let _user = null; // cached user info from last successful session check

function _dispatch() {
  window.dispatchEvent(new CustomEvent('authchange', { detail: { authenticated: isAuthenticated() } }));
}

export function getUser()         { return _user; }
export function isAuthenticated() { return !!_user; }

export async function login(username, password) {
  const res  = await fetch('/auth/login', {
    method:      'POST',
    credentials: 'include', // required for the server to set the httpOnly cookie
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');

  _user = data.user;
  _dispatch();
  return data;
}

export async function logout() {
  _user = null;
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  _dispatch();
}

// Check current session with the server — call on page load to restore state.
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
