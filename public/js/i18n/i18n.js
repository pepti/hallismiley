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

/** The locale the party pages are locked to. Party content is Icelandic-only —
 *  see server/config/i18n.js, which owns the authoritative copy of this rule. */
const PARTY_FORCED_LOCALE = 'is';

/** True for /party and every /party/* sub-route (with or without an /en/ or
 *  /is/ prefix). Mirrors server/config/i18n.js isPartyPath — minus the
 *  /api/v1/party branch, which the server resolves on its own. Kept in lockstep
 *  when either changes. */
function isPartyPath(pathname) {
  if (!pathname) return false;
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] && SUPPORTED_LOCALES.includes(parts[0])) parts.shift();
  const stripped = '/' + parts.join('/');
  return stripped === '/party' || stripped.startsWith('/party/');
}

/** The locale `pathname` is locked to, or null when it may render in any
 *  supported locale. Mirrors server/config/i18n.js forcedLocaleFor. Consumers:
 *  getPreferredLocale + switchLocale + href below, the Router's locale guard,
 *  and the NavBar's language switcher (hidden entirely on locked routes).
 *
 *  Defaults to the current URL so callers on the party page can just ask
 *  `forcedLocaleFor()`. */
export function forcedLocaleFor(pathname = window.location.pathname) {
  return isPartyPath(pathname) ? PARTY_FORCED_LOCALE : null;
}

/** Determine locale from locale-lock → ?locale= → explicit saved choice →
 *  Accept-Language → default.
 *
 *  The lock is checked FIRST — a guest whose saved choice is English still gets
 *  Icelandic on the party page, matching what the server already decided for the
 *  SSR <head> and the API payload.
 *
 *  Only an EXPLICIT choice (the language switcher — see persistLocaleChoice)
 *  is ever saved; auto-resolved fallbacks are not. The storage key is
 *  'locale_choice' — deliberately NOT the old 'preferred_locale' key, which
 *  loadLocale used to write for every resolved locale (including the English
 *  fallback), polluting stored state. Old values are ignored, never migrated. */
export function getPreferredLocale() {
  const forced = forcedLocaleFor(window.location.pathname);
  if (forced) return forced;
  const fromQuery = getLocaleFromQuery();
  if (fromQuery) return fromQuery;
  const saved = localStorage.getItem('locale_choice');
  if (saved && SUPPORTED_LOCALES.includes(saved)) return saved;
  for (const lang of (navigator.languages || [])) {
    const code = lang.split('-')[0].toLowerCase();
    if (SUPPORTED_LOCALES.includes(code)) return code;
  }
  return DEFAULT_LOCALE;
}

/** Persist an EXPLICIT locale choice (localStorage + cookie). Called only
 *  from the language switcher path — never from loadLocale, so a fallback
 *  resolution is never mistaken for a choice. The cookie lets the server's
 *  locale middleware honor the choice on the very next request — even for
 *  anonymous users hitting a deep link before JS has rendered the first
 *  frame. 1-year expiry, SameSite=Lax so it rides along with top-level
 *  navigations (crawlers included). */
export function persistLocaleChoice(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  localStorage.setItem('locale_choice', locale);
  document.cookie = `locale_choice=${locale}; path=/; max-age=31536000; samesite=lax`;
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
  // Deliberately NOT persisted here: loadLocale runs for every auto-resolved
  // locale (including fallbacks), and saving those as if the user chose them
  // is what used to break the party-page Icelandic default. Persistence is
  // persistLocaleChoice's job, triggered only by the explicit switcher.
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
 *  only — no fallback to hash routing (SEO requires clean URLs). This is the
 *  single explicit-choice entry point (NavBar + Profile both route through
 *  it), so it's also where the choice gets persisted. */
export function switchLocale(newLocale) {
  if (!SUPPORTED_LOCALES.includes(newLocale)) return;
  const path = window.location.pathname || '/';
  // Locale-locked route (party): there is nothing to switch to, and persisting
  // a choice made here would leak an English preference into the rest of the
  // site from a page that never offered the option. The NavBar hides the
  // switcher on these routes, so this is the belt-and-braces half.
  if (forcedLocaleFor(path)) return;
  persistLocaleChoice(newLocale);
  const parts = path.split('/').filter(Boolean);
  if (SUPPORTED_LOCALES.includes(parts[0])) parts.shift();
  const newPath = '/' + newLocale + (parts.length ? '/' + parts.join('/') : '/');
  history.pushState(null, '', newPath + window.location.search);
  window.dispatchEvent(new Event('spa:navigate'));
}

/** Build a locale-prefixed clean URL for a route pattern. Returns e.g.
 *  '/en/projects' — consumable by <a href> and history.pushState alike.
 *  Locale-locked routes get their own locale rather than the active one, so
 *  the NavBar's party link reads /is/party even while browsing in English —
 *  the link lands on its final URL instead of bouncing through a redirect. */
export function href(route) {
  const locale = forcedLocaleFor(route) || _locale || DEFAULT_LOCALE;
  return '/' + locale + (route.startsWith('/') ? route : '/' + route);
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
