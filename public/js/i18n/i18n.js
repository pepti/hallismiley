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

/** Read locale from the first path segment of the current URL pathname. */
export function getLocaleFromPath() {
  const path  = window.location.pathname || '/';
  const first = path.split('/').filter(Boolean)[0];
  return (first && SUPPORTED_LOCALES.includes(first)) ? first : null;
}

/** Legacy name kept for backwards compatibility with any caller still on
 *  hash routing. Prefer getLocaleFromPath(). */
export function getLocaleFromHash() { return getLocaleFromPath(); }

/** Read locale from the `?locale=` query param on the URL — set by email
 *  verify/reset links so the landing page renders in the same language as
 *  the email (the user isn't logged in yet, so no server preference). */
export function getLocaleFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const lc = params.get('locale');
  return (lc && SUPPORTED_LOCALES.includes(lc)) ? lc : null;
}

/** Determine locale from ?locale= → localStorage → Accept-Language → default. */
export function getPreferredLocale() {
  const fromQuery = getLocaleFromQuery();
  if (fromQuery) return fromQuery;
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
  // Mirror to a cookie so the server's locale middleware picks it up on the
  // very next request — even for anonymous users hitting a deep link before
  // JS has rendered the first frame. 1-year expiry, SameSite=Lax so cookie
  // rides along with top-level navigations (crawlers included).
  document.cookie = `preferred_locale=${locale}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.lang = locale;

  // Update og:locale so social scrapers that execute JS see the right locale.
  const ogLocale = document.querySelector('meta[property="og:locale"]');
  if (ogLocale) ogLocale.setAttribute('content', locale === 'is' ? 'is_IS' : 'en_IS');

  // Swap og:image to the locale-specific variant when one exists. Falls back
  // to the default /og-image.jpg if /og-image-{locale}.jpg 404s (checked at
  // build-time via the <link rel="preload" as="image">; in-browser we just
  // switch the URL and let the scraper resolve).
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) {
    const base = ogImage.dataset.baseHref || ogImage.getAttribute('content');
    if (!ogImage.dataset.baseHref) ogImage.dataset.baseHref = base;
    // Pattern: /og-image.jpg  →  /og-image.is.jpg  (keep extension intact).
    // Commission the IS variant at public/og-image.is.jpg; until it exists,
    // scrapers still see the default English image — no 404 in the HTML.
    ogImage.setAttribute(
      'content',
      locale === 'is'
        ? base.replace(/(\.[a-z0-9]+)$/i, '.is$1')
        : base
    );
  }

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

/** Switch to `newLocale` by updating the locale prefix in the URL pathname,
 *  which triggers the Router's popstate handler to re-render. History API
 *  only — no fallback to hash routing (SEO requires clean URLs). */
export function switchLocale(newLocale) {
  if (!SUPPORTED_LOCALES.includes(newLocale)) return;
  const path  = window.location.pathname || '/';
  const parts = path.split('/').filter(Boolean);
  if (SUPPORTED_LOCALES.includes(parts[0])) parts.shift();
  const newPath = '/' + newLocale + (parts.length ? '/' + parts.join('/') : '/');
  history.pushState(null, '', newPath + window.location.search);
  window.dispatchEvent(new Event('spa:navigate'));
}

/** Build a locale-prefixed clean URL for a route pattern. Returns e.g.
 *  '/en/projects' — consumable by <a href> and history.pushState alike. */
export function href(route) {
  return '/' + (_locale || DEFAULT_LOCALE) + (route.startsWith('/') ? route : '/' + route);
}

/**
 * HTML snippet for a small "EDITING: {locale}" pill shown next to admin inline
 * edit controls. Reminds admins which locale they're editing so they don't
 * accidentally overwrite the other language's copy. Caller inserts the string
 * directly into innerHTML — the span has `data-testid="admin-locale-badge"`
 * and its own BEM class.
 *
 * Also includes an empty "untranslated" chip slot (hidden by default) which
 * inline editors can populate via `markUntranslatedBadge(root, isUntranslated)`
 * after comparing the loaded content against the other locale's row.
 */
export function adminLocaleBadgeHtml() {
  const key = _locale === 'is' ? 'admin.editingLocaleBadgeIs' : 'admin.editingLocaleBadgeEn';
  const tip = _locale === 'is' ? 'admin.editingInIs' : 'admin.editingInEn';
  return `<span class="admin-locale-badge admin-locale-badge--${_locale}"
                data-testid="admin-locale-badge"
                title="${t(tip)}">${t(key)}</span>
          <span class="admin-untranslated-chip" data-testid="admin-untranslated-chip"
                hidden title="${t('admin.untranslatedTip')}">${t('admin.untranslated')}</span>`;
}

/**
 * Fetch a site_content row in both locales and compare the stored JSON. If
 * the active locale's copy is identical to the fallback locale's copy, the
 * block is effectively untranslated — reveal the warning chip placed by
 * adminLocaleBadgeHtml(). Best-effort; network errors fail silently.
 */
export async function checkUntranslated(key, controlsRoot) {
  if (_locale === DEFAULT_LOCALE) return; // nothing to check — active is the source
  const chip = controlsRoot?.querySelector('.admin-untranslated-chip');
  if (!chip) return;
  try {
    const [activeRes, fallbackRes] = await Promise.all([
      fetch(`/api/v1/content/${encodeURIComponent(key)}?locale=${encodeURIComponent(_locale)}`),
      fetch(`/api/v1/content/${encodeURIComponent(key)}?locale=${encodeURIComponent(DEFAULT_LOCALE)}`),
    ]);
    if (!activeRes.ok || !fallbackRes.ok) return;
    const [a, b] = await Promise.all([activeRes.json(), fallbackRes.json()]);
    const same = JSON.stringify(a) === JSON.stringify(b);
    chip.hidden = !same;
  } catch {
    // swallow — the chip stays hidden, which is the safe default
  }
}
