// Client-side i18n module.
// Usage:
//   import { t, loadLocale, getLocale, setLocale } from './i18n/i18n.js';
//   await loadLocale('en');
//   t('nav.home')              // → "Home"
//   t('shop.inStock', {n: 3}) // → "3 in stock"

export const SUPPORTED_LOCALES = ['en', 'is'];
export const DEFAULT_LOCALE    = 'en';

let _locale   = DEFAULT_LOCALE;
let _messages = {};
let _fallback = {};

// ── Locale detection helpers ──────────────────────────────────────────────────

export function getLocale() { return _locale; }

/** Read locale from the first path segment of the current URL hash. */
export function getLocaleFromHash() {
  const hash  = window.location.hash.replace(/^#/, '') || '/';
  const first = hash.split('/').filter(Boolean)[0];
  return (first && SUPPORTED_LOCALES.includes(first)) ? first : null;
}

/** Determine locale from localStorage → Accept-Language → default. */
export function getPreferredLocale() {
  const saved = localStorage.getItem('preferred_locale');
  if (saved && SUPPORTED_LOCALES.includes(saved)) return saved;
  for (const lang of (navigator.languages || [])) {
    const code = lang.split('-')[0].toLowerCase();
    if (SUPPORTED_LOCALES.includes(code)) return code;
  }
  return DEFAULT_LOCALE;
}

// ── Loader ────────────────────────────────────────────────────────────────────

/** Fetch the JSON for `locale` and cache it. Always resolves — on network
 *  error falls back silently to empty messages (en fallback still applies). */
export async function loadLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) locale = DEFAULT_LOCALE;

  try {
    const [msgs, fallback] = await Promise.all([
      fetch(`/js/i18n/${locale}.json`).then(r => r.json()),
      locale !== DEFAULT_LOCALE
        ? fetch(`/js/i18n/${DEFAULT_LOCALE}.json`).then(r => r.json())
        : Promise.resolve(null),
    ]);
    _messages = msgs;
    _fallback = fallback ?? msgs;
  } catch {
    _messages = {};
    _fallback = {};
  }

  _locale = locale;
  window.__locale = locale;
  localStorage.setItem('preferred_locale', locale);
  document.documentElement.lang = locale;

  // Update og:locale so social scrapers that execute JS see the right locale.
  const ogLocale = document.querySelector('meta[property="og:locale"]');
  if (ogLocale) ogLocale.setAttribute('content', locale === 'is' ? 'is_IS' : 'en_IS');

  // Send X-Locale with all subsequent fetch calls via the global header store.
  // Individual API helpers read window.__locale directly.
}

// ── Translation function ──────────────────────────────────────────────────────

/**
 * Look up `key` in the active locale messages, falling back to DEFAULT_LOCALE.
 * Supports {param} interpolation: t('shop.inStock', { n: 3 }) → "3 in stock"
 */
export function t(key, params) {
  let msg = _messages[key] ?? _fallback[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return msg;
}

// ── Locale switcher ───────────────────────────────────────────────────────────

/** Switch to `newLocale` by updating the locale prefix in the URL hash,
 *  which triggers a hashchange and full view re-render via the Router. */
export function switchLocale(newLocale) {
  if (!SUPPORTED_LOCALES.includes(newLocale)) return;
  const hash  = window.location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean);
  if (SUPPORTED_LOCALES.includes(parts[0])) parts.shift();
  const newPath = '/' + newLocale + (parts.length ? '/' + parts.join('/') : '/');
  window.location.hash = '#' + newPath;
}

/** Build a locale-prefixed hash string for a route pattern. */
export function href(route) {
  return '#/' + (_locale || DEFAULT_LOCALE) + (route.startsWith('/') ? route : '/' + route);
}

/**
 * HTML snippet for a small "EDITING: {locale}" pill shown next to admin inline
 * edit controls. Reminds admins which locale they're editing so they don't
 * accidentally overwrite the other language's copy. Caller inserts the string
 * directly into innerHTML — the span has `data-testid="admin-locale-badge"`
 * and its own BEM class.
 */
export function adminLocaleBadgeHtml() {
  const key = _locale === 'is' ? 'admin.editingLocaleBadgeIs' : 'admin.editingLocaleBadgeEn';
  const tip = _locale === 'is' ? 'admin.editingInIs' : 'admin.editingInEn';
  return `<span class="admin-locale-badge admin-locale-badge--${_locale}"
                data-testid="admin-locale-badge"
                title="${t(tip)}">${t(key)}</span>`;
}
