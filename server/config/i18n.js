'use strict';

const DEFAULT_LOCALE    = process.env.DEFAULT_LOCALE    || 'en';
const SUPPORTED_LOCALES = (process.env.SUPPORTED_LOCALES || 'en,is')
  .split(',').map(l => l.trim()).filter(Boolean);

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

// The locale a path is LOCKED to, or null when it may render in any supported
// locale. Page routes only — see the note above on why the API is excluded.
// The single place that answers "is this route locale-locked?" server-side;
// public/js/i18n/i18n.js mirrors it for the SPA.
function forcedLocaleFor(pathname) {
  if (!pathname) return null;
  return isPartyPageRoute(pathname) ? PARTY_FORCED_LOCALE : null;
}

module.exports = {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  PARTY_FORCED_LOCALE,
  isPartyPath,
  forcedLocaleFor,
};
