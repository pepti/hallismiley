// Analytics-cookie choice on the ACCOUNT (users.cookie_consent, migration 111;
// harvested from icelandicstore #411, 2026-09-24), not only in this browser's
// localStorage (Halli, 2026-09-23: a signed-in user who already answered was
// asked again). consent.js — a classic script that runs before the SPA — owns
// the banner and exposes window.__cookieConsent; this module is the account
// side of it:
//   - signed in and the account holds an answer → adopt it here, no banner;
//   - signed in, no answer on the account but one in this browser → save it up,
//     so users who accepted before this shipped are carried over on their next visit;
//   - a choice made on the banner while signed in → saved to the account.
// When the two disagree, DECLINED wins: an account "declined" is applied here,
// but an account "accepted" never overrides a browser where someone declined
// (a shared computer must not start analytics for the person who said no).

import { getUser, isAuthenticated, updateCachedUser, getCSRFToken } from './auth.js';

const VALUES = ['accepted', 'declined'];
const api = () => (typeof window !== 'undefined' ? window.__cookieConsent : null);

// Engine: no shared-device role (ice refuses its workshop tablet here).
const canSave = () => isAuthenticated();

export async function saveCookieConsent(value) {
  if (!VALUES.includes(value) || !canSave()) return false;
  try {
    const token = await getCSRFToken();
    const res = await fetch('/api/v1/users/me/cookie-consent', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) return false;
    updateCachedUser({ cookie_consent: value }, { silent: true });
    return true;
  } catch {
    return false;
  }
}

export function syncCookieConsent() {
  const banner = api();
  const user = getUser();
  if (!banner || !user) return;
  if (VALUES.includes(user.cookie_consent)) {
    // Also drops a banner already on screen.
    if (user.cookie_consent === 'declined' || banner.get() !== 'declined') banner.apply(user.cookie_consent);
    return;
  }
  const local = banner.get();
  if (VALUES.includes(local)) saveCookieConsent(local);
}

// Once, after the first session check (main.js). Tells consent.js it may show
// the banner now if nobody has answered.
export function initCookieConsent() {
  const banner = api();
  if (banner) banner.onChoice = (value) => { saveCookieConsent(value); };
  syncCookieConsent();
  // A sign-in on this page. The session restore at boot needs no listener:
  // main.js calls this AFTER tryRestoreSession, so the sync above covered it
  // (and the engine's restore dispatches no reason to tell it from a profile
  // save, which must not re-sync).
  window.addEventListener('authchange', (e) => {
    const reason = e.detail?.reason;
    if (reason === 'login' || reason === 'restore') syncCookieConsent();
  });
  window.dispatchEvent(new Event('consent:ready'));
}

// "Change cookie choice" — shows the banner again; the answer saves as above.
export function reopenCookieChoice() {
  api()?.reopen();
}
