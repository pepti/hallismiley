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

export const THEMES = ['classic', 'glacier', 'moss', 'lava', 'aurora', 'black-sand'];
const DEFAULT_THEME = 'classic';
const THEME_KEY = 'ws_theme';
const TEST_KEY  = 'ws_test_override';
const DEMO_KEY  = 'ws_demo_mode';

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable — the preference just won't persist */ }
}

export function getTheme() {
  const v = read(THEME_KEY);
  return THEMES.includes(v) ? v : DEFAULT_THEME;
}

export function setTheme(theme) {
  const next = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  write(THEME_KEY, next === DEFAULT_THEME ? null : next);
  applyTheme();
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
// 'test' override left in a PROD browser is simply ignored. (Ported from
// icelandicstore #108.)
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

export function initTheme() {
  applyTheme();
}
