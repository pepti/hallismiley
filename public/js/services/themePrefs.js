// Theme + per-browser TEST-mode preferences — single source of truth for the
// three localStorage keys and the <html data-theme> attribute.
//
// `ws_theme` — one of THEMES; absent = classic (the :root default, so the
// attribute is removed rather than set).
// `ws_test_override` — 'test' | 'production'; absent = follow the server's
// APP_ENV (the <meta name="app-env"> stamped by ssrMeta.js). The override is
// purely client-side, and it can only ever turn the test affordances OFF —
// never on. See getEffectiveEnv(): the blue TEST chrome means "this really is
// the TEST stack" and nothing else. The change-request submit endpoint is
// gated by the server's real APP_ENV regardless (requireTestEnv).
// `ws_demo_mode` — '1' = demo mode on; absent = off. A presentation overlay
// layered on top of TEST (see test-env.css / ChangeRequestWidget); purely
// client-side and only meaningful while the test affordances are showing.
//
// public/js/theme-boot.js (pre-paint classic script in index.html) duplicates
// the theme read + admin guard — keep the two in sync.
//
// The theme has a SECOND home for logged-in users: users.theme on the account
// (migration 081_user_theme). localStorage stays the pre-paint cache — it is
// the only store a synchronous <head> script can read — while the account copy
// makes the choice follow the LOGIN to another browser or device:
//   • change → setTheme() writes localStorage AND PATCHes /users/me;
//   • login/session-restore → authchange fires → adoptAccountTheme() copies the
//     server value back into localStorage and repaints.
// Anonymous visitors are unaffected: no session, no write, browser-local only.

import { getUser, isAuthenticated, updateProfile, updateCachedUser } from './auth.js';

export const THEMES = ['classic', 'glacier', 'moss', 'lava', 'aurora', 'black-sand'];
const DEFAULT_THEME = 'classic';
const THEME_KEY = 'ws_theme';
const TEST_KEY  = 'ws_test_override';
const DEMO_KEY  = 'ws_demo_mode';

// Swatch fills for the theme pickers (ThemeSwitcher popover + the profile
// Appearance section). Hard-coded on purpose: each swatch advertises its OWN
// theme regardless of which one is active, so these can't come from the live
// CSS variables. The colour themes show an accent→background gradient so the
// swatch previews their immersive look.
export const THEME_SWATCHES = {
  classic: '#202020',
  glacier: 'linear-gradient(135deg, #5FB4E8 0%, #0B2138 100%)',
  moss: 'linear-gradient(135deg, #6FD08E 0%, #0F2418 100%)',
  lava: 'linear-gradient(135deg, #FF8347 0%, #221210 100%)',
  aurora: 'linear-gradient(135deg, #CDB8FB 0%, #123E39 100%)',
  'black-sand': '#1A1A1A',
};

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable — the preference just won't persist */ }
}

// The theme applied during this page lifetime. localStorage is the pre-paint
// cache, not the source of truth: when it is unavailable (Safari private mode,
// site data blocked) the write above is swallowed, and reading storage back
// would report classic while the page is visibly painted in something else —
// leaving the pickers highlighting the wrong swatch.
let _current = null;

export function getTheme() {
  if (_current) return _current;
  const v = read(THEME_KEY);
  return THEMES.includes(v) ? v : DEFAULT_THEME;
}

// Apply a theme and remember it. `persist` is the account write-back — the
// only callers that turn it off are the ones already applying what the server
// told us. Returns the theme actually applied (an unknown id falls back to
// classic); the account write is debounced and fire-and-forget, so the UI
// never waits on the network to repaint.
export function setTheme(theme, { persist = true } = {}) {
  const next = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  write(THEME_KEY, next === DEFAULT_THEME ? null : next);
  _current = next;
  applyTheme();
  // Lets the two pickers (switcher popover, profile Appearance section) keep
  // their selected state in step when the other one changes the theme.
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
  if (persist) saveThemeToAccount(next);
  return next;
}

// How long to sit on a change before writing it to the account. The picker is
// a radiogroup, so arrow keys move the selection — and a held arrow key
// auto-repeats at ~30/s. One PATCH per keypress would burn the global limiter
// (400 requests / 15 min, app-wide per IP) in seconds and 429 the whole site,
// so a burst collapses into a single write for the selection landed on.
const SAVE_DEBOUNCE_MS = 400;

let _saveTimer   = null;
let _saveWanted  = null;
let _saveWaiters = [];
// Writes are chained rather than fired in parallel: two overlapping PATCHes
// can commit in either order, which would leave the account holding a theme
// the user had already moved off.
let _saveChain = Promise.resolve();

function _flushSave(theme) {
  const run = _saveChain.then(() => updateProfile({ theme })
    .then(() => {
      // Keep the cached session in step, or the next authchange would re-adopt
      // the stale server value and flip the theme back under the user. Silent:
      // the router re-navigates on authchange, which would tear down whatever
      // view the user is on just to repaint a theme that is already applied.
      updateCachedUser({ theme }, { silent: true });
      return true;
    })
    .catch(() => false));
  _saveChain = run.catch(() => {});
  return run;
}

// Push the current choice to the logged-in account. Anonymous visitors resolve
// false without a request. Resolves false (never throws) on a failed write, so
// callers can surface "saved to this browser only" without a try/catch — the
// theme is already applied locally either way. Callers superseded within the
// debounce window resolve with the outcome of the write that replaced them, so
// a status line never reports on a selection the user has already left.
export function saveThemeToAccount(theme, { delay = SAVE_DEBOUNCE_MS } = {}) {
  const next = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  if (!isAuthenticated()) return Promise.resolve(false);
  // Already what the account holds — nothing to write. But a save armed by an
  // EARLIER selection may still be pending, and letting it fire would persist a
  // theme the user merely passed through (arrow-keying the Appearance radios, or
  // two clicks inside the debounce window). Disarm it and settle its waiters
  // truthfully: the account already ends up in the state they asked for.
  if (getUser()?.theme === next) {
    _saveWanted = next;
    clearTimeout(_saveTimer);
    const waiters = _saveWaiters;
    _saveWaiters = [];
    waiters.forEach((r) => r(true));
    return Promise.resolve(true);
  }

  _saveWanted = next;
  clearTimeout(_saveTimer);
  return new Promise((resolve) => {
    _saveWaiters.push(resolve);
    _saveTimer = setTimeout(() => {
      const wanted  = _saveWanted;
      const waiters = _saveWaiters;
      _saveWaiters = [];
      _flushSave(wanted).then((ok) => waiters.forEach((r) => r(ok)));
    }, delay);
  });
}

// Server → browser direction only: copy the account's saved theme into
// localStorage and repaint. Never writes back.
export function adoptAccountTheme() {
  const theme = getUser()?.theme;
  if (!theme || !THEMES.includes(theme) || theme === getTheme()) return;
  setTheme(theme, { persist: false });
}

// The theme this browser was showing before the current login. Captured once
// per login so logout can hand it back — otherwise the next person to sign in
// on a shared terminal (the POS and scan surfaces are exactly that) inherits
// the previous user's theme, with no way to tell why the colours changed.
let _preLogin = null;

function _onAuthChange() {
  if (!getUser()) {
    // Logged out. Restore what the browser chose for itself, so an account
    // theme never outlives the session that brought it in.
    if (_preLogin === null) return;
    const back = _preLogin;
    _preLogin = null;
    setTheme(back, { persist: false });
    return;
  }
  if (_preLogin === null) _preLogin = getTheme();
  adoptAccountTheme();
}

export function getServerEnv() {
  return document.querySelector('meta[name="app-env"]')?.content || 'production';
}

export function getTestOverride() {
  const v = read(TEST_KEY);
  return v === 'test' || v === 'production' ? v : null;
}

// null clears the override (browser follows the server again). Callers pass
// null when the wanted value equals the server env, so the key self-cleans.
export function setTestOverride(value) {
  write(TEST_KEY, value === 'test' || value === 'production' ? value : null);
}

// The env the client chrome should render as — the single source of truth for
// body.is-test-env (badge + nav/footer glow) and the change-request widget.
//
// One-way clamp on purpose: on the TEST stack an admin may hide the chrome for
// a demo (override 'production'), but no browser state can make PROD wear the
// TEST colours. That keeps the blue badge a trustworthy "you are NOT on the
// live site" signal, and stops an admin from being handed a change-request
// widget whose submit endpoint 404s in production (requireTestEnv). A stale
// 'test' override left in a PROD browser is simply ignored.
export function getEffectiveEnv() {
  if (getServerEnv() !== 'test') return 'production';
  return getTestOverride() === 'production' ? 'production' : 'test';
}

// Demo mode — a presentation overlay layered on top of TEST: hides the loud
// test chrome (badge + nav/footer glow) and collapses the change-request
// launcher to a thin line. Persisted so a mid-demo reload doesn't flash it back.
export function getDemoMode() {
  return read(DEMO_KEY) === '1';
}
export function setDemoMode(on) {
  write(DEMO_KEY, on ? '1' : null);
}

export function applyTheme() {
  const theme = getTheme();
  // classic is the :root default → no attribute. Every other theme (including
  // black-sand) applies everywhere, admin included; the admin CSS is tokenized
  // and themes.css carries the dark-mode admin fixes.
  if (theme === DEFAULT_THEME) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

let _authBound = false;

export function initTheme() {
  applyTheme();
  // Bound once, before main.js restores the session, so the account's theme is
  // adopted during that restore — i.e. before the first render.
  if (!_authBound) {
    _authBound = true;
    window.addEventListener('authchange', _onAuthChange);
  }
}
