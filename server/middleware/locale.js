'use strict';
// Locale detection middleware — sets req.locale for every request.
// Priority (highest first):
//   0. Locale-locked PAGE routes (forcedLocaleFor) — the party pages are
//      Icelandic-only and ignore every signal below.
//   1. ?locale= query param (used by SPA API calls)
//   2. X-Locale request header
//   3. locale_choice cookie (the user's EXPLICIT switcher choice)
//   4. Logged-in user's saved preferred_locale
//   5. Party-route default ('is' for /party* and /api/v1/party/*)
//   6. PUBLIC_DEFAULT_LOCALE ('is' — the visitor-facing default; distinct
//      from DEFAULT_LOCALE, the content-fallback dimension)
//
// Accept-Language is deliberately NOT consulted. This is an Icelandic
// company selling to Icelandic businesses, and a large share of Icelandic
// users run an English-language OS or browser — so `Accept-Language: en-US`
// says almost nothing about which language the visitor wants to read the
// site in, while confidently overriding the Icelandic default for most of
// the target market. English is one click away in the header and is
// remembered (locale_choice) once chosen, so nobody is stranded. Only an
// EXPLICIT signal moves a visitor off Icelandic.
//
// Explicit per-request signals (query / header / cookie) win over the
// account-level preference so that an admin whose users.preferred_locale='is'
// can still browse /en/* or fetch ?locale=en content without their saved
// preference overriding the URL they're actually on.
//
// The page lock (0) sits above all of them — that's the point of a lock. A
// guest with locale_choice=en who opens a party magic link still gets the
// Icelandic page, so the SSR <head> and the SPA can never disagree about it.
//
// The party API is deliberately NOT locked (see config/i18n.js): its ?locale=
// selects which content row to read/write, so locking it would let a stray
// ?locale=en overwrite the Icelandic source copy. It keeps step 5 instead —
// the long-standing Icelandic default for visitors who never chose a language.
//
// The locale_choice cookie is written ONLY by the client's explicit language
// switcher (public/js/i18n/i18n.js persistLocaleChoice) — never for
// auto-resolved fallbacks. The old 'preferred_locale' cookie used to mirror
// every resolved locale (fallbacks included), which polluted stored state and
// defeated the party default below; it is deliberately ignored, not migrated.

const {
  PUBLIC_DEFAULT_LOCALE, SUPPORTED_LOCALES, PARTY_FORCED_LOCALE, isPartyPath, forcedLocaleFor,
} = require('../config/i18n');

// Resolve the active locale from a request using the documented priority.
// Exported so the auth middleware can re-run resolution after req.user is set
// — the global middleware runs before auth, so req.user is undefined on that
// first pass. Calling this again post-auth lets the saved preferred_locale
// participate in resolution without trampling explicit per-request signals.
function resolveLocale(req) {
  const forced = forcedLocaleFor(req.path);
  if (forced) return forced;

  const candidates = [
    req.query?.locale,
    req.headers['x-locale'],
    req.cookies?.locale_choice,
    req.user?.preferred_locale,
  ];

  for (const c of candidates) {
    if (c && SUPPORTED_LOCALES.includes(c)) return c;
  }

  if (isPartyPath(req.path)) return PARTY_FORCED_LOCALE;

  return PUBLIC_DEFAULT_LOCALE;
}

function localeMiddleware(req, _res, next) {
  req.locale = resolveLocale(req);
  next();
}

module.exports = localeMiddleware;
module.exports.resolveLocale = resolveLocale;
