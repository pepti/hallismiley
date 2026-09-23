'use strict';

/**
 * The visitor-default locale for the test suites (identity-seam-2, 2026-09-23).
 *
 * The engine's suites used to assert Icelandic API strings and `/is/`
 * redirects as literals — true for Orange Smiley (identity.locale.publicDefault
 * = 'is') and false for a downstream whose visitor default is 'en'. The
 * expected value is the RESOLVED config's, so the same suite passes in both:
 *
 *   PUBLIC_DEFAULT_LOCALE  what server/config/i18n.js resolved (identity.*
 *                          under the PUBLIC_DEFAULT_LOCALE env var, as before)
 *   OTHER_LOCALE           the other supported locale, for suites that
 *                          deliberately exercise both
 *   tx(key, params)        the server table's exact string in the visitor
 *                          default — server/i18n t(PUBLIC_DEFAULT_LOCALE, …)
 *   tClient(key, params)   the same for the SPA table (public/js/i18n +
 *                          product overlay), for e2e specs reading the DOM
 *   localePrefix()         '/is' — for redirect targets: `${localePrefix()}/`
 *
 * Assertions stay exact (`toBe(tx('errors.auth.invalidCredentials'))`), never
 * weakened to "something came back": what moves is where the expected text
 * comes from, not how strictly it is compared.
 */
const fs = require('fs');
const path = require('path');
const { PUBLIC_DEFAULT_LOCALE, SUPPORTED_LOCALES, DEFAULT_LOCALE } = require('../../server/config/i18n');
const { t } = require('../../server/i18n');

const ROOT = path.join(__dirname, '../..');
const OTHER_LOCALE = SUPPORTED_LOCALES.find((lc) => lc !== PUBLIC_DEFAULT_LOCALE) || PUBLIC_DEFAULT_LOCALE;

function tx(key, params) {
  return t(PUBLIC_DEFAULT_LOCALE, key, params);
}

function localePrefix(locale = PUBLIC_DEFAULT_LOCALE) {
  return `/${locale}`;
}

// The SPA's tables, read from disk the way public/js/i18n/i18n.js fetches
// them: engine table + product overlay, the DEFAULT_LOCALE table as fallback.
const _client = {};
function clientTable(locale) {
  if (_client[locale]) return _client[locale];
  const read = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'public/js/i18n', name), 'utf8')); } catch { return {}; }
  };
  _client[locale] = { ...read(`${locale}.json`), ...read(`product.${locale}.json`) };
  return _client[locale];
}

function tClient(key, params, locale = PUBLIC_DEFAULT_LOCALE) {
  const msgs = clientTable(locale);
  const fallback = locale !== DEFAULT_LOCALE ? clientTable(DEFAULT_LOCALE) : msgs;
  let msg = msgs[key] ?? fallback[key] ?? key;
  for (const [k, v] of Object.entries(params || {})) {
    msg = msg.split(`{${k}}`).join(String(v));
  }
  return msg;
}

module.exports = { PUBLIC_DEFAULT_LOCALE, OTHER_LOCALE, DEFAULT_LOCALE, tx, tClient, localePrefix };
