// Global 401 guard. When the server rejects an AUTHENTICATED data-API call with
// 401, the session is gone (expired, or the auth_session cookie was dropped —
// e.g. the browser closed on a computer restart). Without this, the SPA keeps
// painting admin chrome from its in-memory user while every call 401s ("Something
// went wrong: Unauthorized"). Clear the stale auth state and bounce home + a toast
// so the user just signs in again.
//
// Scoped to /api/v1/* responses while the client THINKS it is logged in. Auth
// endpoints never match (login bad-creds 401s while no user is cached yet), and a
// dedupe flag keeps a page firing several parallel calls to one redirect. Mirrors
// installRateLimitGuard()'s fetch-wrapper pattern.
import { isAuthenticated, clearSession } from './auth.js';
import { navigate } from '../navigate.js';
import { t, href } from '../i18n/i18n.js';
import { showToast } from '../components/Toast.js';

let _handling = false;

function pathOf(input) {
  try {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    return raw.startsWith('http') ? new URL(raw).pathname : raw;
  } catch { return ''; }
}

function inspect(res, input) {
  if (res.status !== 401 || _handling || !isAuthenticated()) return;
  if (!pathOf(input).startsWith('/api/v1/')) return; // only our own data API
  _handling = true;
  clearSession();
  try { showToast(t('auth.sessionExpired'), 'error', 6000); } catch { /* toast is best-effort */ }
  navigate(href('/'));
  // Re-arm after the redirect settles so a later genuine expiry is caught too.
  setTimeout(() => { _handling = false; }, 2000);
}

export function installSessionGuard() {
  if (typeof window === 'undefined' || !window.fetch) return;
  if (window.__sessionGuardInstalled) return;
  window.__sessionGuardInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await originalFetch(...args);
    try { inspect(res, args[0]); } catch { /* never break the caller */ }
    return res;
  };
}
