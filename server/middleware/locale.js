'use strict';
// Locale detection middleware — sets req.locale for every request.
// Priority (highest first):
//   1. ?locale= query param (used by SPA API calls)
//   2. X-Locale request header
//   3. preferred_locale cookie
//   4. Logged-in user's saved preferred_locale
//   5. Party-route default ('is' for /party, /party/admin, /api/v1/party/*)
//   6. Accept-Language header (first supported language)
//   7. DEFAULT_LOCALE
//
// Explicit per-request signals (query / header / cookie) win over the
// account-level preference so that an admin whose users.preferred_locale='is'
// can still browse /en/* or fetch ?locale=en content without their saved
// preference overriding the URL they're actually on. The client mirrors the
// active locale to the preferred_locale cookie (public/js/i18n/i18n.js), so
// fresh sessions still inherit the account default via cookie + user pref.
//
// The party-route default sits between saved-preference signals and
// Accept-Language so that visitors with no cookie / no saved pref land on
// the birthday page in Icelandic, even if their browser advertises English.

const { DEFAULT_LOCALE, SUPPORTED_LOCALES, PARTY_DEFAULT_LOCALE, isPartyPath } = require('../config/i18n');

function pickFromAcceptLanguage(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const code = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (SUPPORTED_LOCALES.includes(code)) return code;
  }
  return null;
}

// Resolve the active locale from a request using the documented priority.
// Exported so the auth middleware can re-run resolution after req.user is set
// — the global middleware runs before auth, so req.user is undefined on that
// first pass. Calling this again post-auth lets the saved preferred_locale
// participate in resolution without trampling explicit per-request signals.
function resolveLocale(req) {
  const candidates = [
    req.query?.locale,
    req.headers['x-locale'],
    req.cookies?.preferred_locale,
    req.user?.preferred_locale,
  ];

  for (const c of candidates) {
    if (c && SUPPORTED_LOCALES.includes(c)) return c;
  }

  if (isPartyPath(req.path)) return PARTY_DEFAULT_LOCALE;

  return pickFromAcceptLanguage(req.headers['accept-language']) || DEFAULT_LOCALE;
}

function localeMiddleware(req, _res, next) {
  req.locale = resolveLocale(req);
  next();
}

module.exports = localeMiddleware;
module.exports.resolveLocale = resolveLocale;
