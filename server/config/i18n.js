'use strict';

const DEFAULT_LOCALE    = process.env.DEFAULT_LOCALE    || 'en';
const SUPPORTED_LOCALES = (process.env.SUPPORTED_LOCALES || 'en,is')
  .split(',').map(l => l.trim()).filter(Boolean);

// The locale a brand-new visitor sees when no signal (URL prefix, cookie,
// account preference, Accept-Language) resolves one. It is the PRODUCT's
// choice — `identity.locale.publicDefault` in config/client.json ('is' for
// Orange Smiley, an Icelandic business) — and the env var still wins over it,
// as it did before the identity seam.
//
// Deliberately separate from DEFAULT_LOCALE above, which is the CONTENT
// dimension: the t()/site_content fallback locale and the storage locale for
// locale-neutral rows (party module, shared images). The base wrote English
// content first, so that dimension stays 'en' — flipping it would silently
// re-home stored rows and break the party module's IS-primary/EN-translated
// contract. Only the visitor-facing default changes.
const { identity } = require('./identity');
const PUBLIC_DEFAULT_LOCALE = process.env.PUBLIC_DEFAULT_LOCALE || identity.locale.publicDefault;

// The party pages are a birthday landing for an Iceland-based event with an
// all-Icelandic guest list — they are published in Icelandic ONLY.
//
// The lock applies to the PAGE routes, which is what a visitor sees: /en/party
// 301s to /is/party, the SSR <head> renders Icelandic whatever the request
// asked for, the language switcher is hidden, and the sitemap advertises a
// single is-only URL with no hreflang alternates.
//
// It deliberately does NOT extend to /api/v1/party/*. That API's ?locale= is a
// content-authoring dimension, not a display choice: the party page is
// IS-primary and auto-translates IS → EN (see partyController), so a locked API
// would make `PATCH /party/info?locale=en` silently overwrite the Icelandic row
// and would stamp preferred_locale='is' onto guests who sign up through an
// English link — clobbering their language for the whole rest of the site. The
// page routes are locked; the API keeps its long-standing Icelandic *default*
// for non-choosers (see middleware/locale.js).
//
// To re-enable English later: drop the isPartyPageRoute branch from
// forcedLocaleFor and the lock unwinds — every consumer routes through it.
const PARTY_FORCED_LOCALE = 'is';

// Strip a leading locale segment so callers can pass '/en/party', '/is/party',
// or a bare '/party' interchangeably.
function stripLocale(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] && SUPPORTED_LOCALES.includes(parts[0])) parts.shift();
  return '/' + parts.join('/');
}

// The party page and its sub-routes (/party/admin, /party/login,
// /party/approve) — with or without a locale prefix.
function isPartyPageRoute(pathname) {
  const stripped = stripLocale(pathname);
  return stripped === '/party' || stripped.startsWith('/party/');
}

function isPartyApiPath(pathname) {
  const stripped = stripLocale(pathname);
  return stripped === '/api/v1/party' || stripped.startsWith('/api/v1/party/');
}

// True for anything party-related, page or API. Used for the Icelandic default
// applied to visitors who never picked a language.
function isPartyPath(pathname) {
  if (!pathname) return false;
  return isPartyPageRoute(pathname) || isPartyApiPath(pathname);
}

// Hidden one-off pages published in Icelandic only. Exact match after the
// locale prefix is stripped — no sub-routes, no prefix matching. Each entry is
// a page with no nav link and no sitemap entry (noindex via publicSurface.js).
//   /aron13ara — Aron's 13th-birthday puzzle page (2026-09-06).
// hallismiley residual hook (engine-graft): the engine has no IS-only pages.
const IS_ONLY_PAGES = new Set(['/aron13ara']);

function isIsOnlyPage(pathname) {
  return IS_ONLY_PAGES.has(stripLocale(pathname));
}

// The locale a path is LOCKED to, or null when it may render in any supported
// locale. Page routes only — see the note above on why the API is excluded.
// The single place that answers "is this route locale-locked?" server-side;
// public/js/i18n/i18n.js mirrors it for the SPA.
function forcedLocaleFor(pathname) {
  if (!pathname) return null;
  if (isPartyPageRoute(pathname)) return PARTY_FORCED_LOCALE;
  if (isIsOnlyPage(pathname))     return 'is';
  return null;
}

module.exports = {
  DEFAULT_LOCALE,
  PUBLIC_DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  PARTY_FORCED_LOCALE,
  isPartyPath,
  forcedLocaleFor,
};
