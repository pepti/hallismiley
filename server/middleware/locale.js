'use strict';
// Locale detection middleware — sets req.locale for every request.
// Priority (highest first):
//   1. Logged-in user's saved preferred_locale
//   2. ?locale= query param (used by SPA API calls)
//   3. X-Locale request header
//   4. preferred_locale cookie
//   5. Accept-Language header (first supported language)
//   6. DEFAULT_LOCALE

const { DEFAULT_LOCALE, SUPPORTED_LOCALES } = require('../config/i18n');

function pickFromAcceptLanguage(header) {
  if (!header) return null;
  for (const part of header.split(',')) {
    const code = part.split(';')[0].trim().toLowerCase().split('-')[0];
    if (SUPPORTED_LOCALES.includes(code)) return code;
  }
  return null;
}

module.exports = function localeMiddleware(req, _res, next) {
  if (req.user?.preferred_locale && SUPPORTED_LOCALES.includes(req.user.preferred_locale)) {
    req.locale = req.user.preferred_locale;
    return next();
  }

  const candidates = [
    req.query?.locale,
    req.headers['x-locale'],
    req.cookies?.preferred_locale,
  ];

  for (const c of candidates) {
    if (c && SUPPORTED_LOCALES.includes(c)) {
      req.locale = c;
      return next();
    }
  }

  req.locale = pickFromAcceptLanguage(req.headers['accept-language']) || DEFAULT_LOCALE;
  next();
};
