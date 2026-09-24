'use strict';
// Server-side i18n helper.
// Usage: const { t } = require('../i18n');
//        t('en', 'email.verify.subject')
//        t('is', 'email.order.subject', { orderNumber: 'ORD-001' })
//
// Three params are IMPLICIT on every call, so the engine's email and meta
// strings carry no brand literal (the identity seam, 2026-09-22):
//   {siteName}  identity.brand.name       — "Orange Smiley" here
//   {legalName} identity.brand.legalName  — "Orange Smiley ehf." (the meta
//               descriptions name the registered company; identity-seam-2)
//   {siteHost}  the host of APP_URL, without a leading "www." — "orangesmiley.is"
// An explicit param of the same name wins. Product-specific wording still goes
// in product.<locale>.json; these placeholders are for the engine table.

const { DEFAULT_LOCALE, SUPPORTED_LOCALES } = require('../config/i18n');
const { identity } = require('../config/identity');

const _cache = {};

// Engine table + this product's overlay (D-021): `<locale>.json` is
// engine-owned and arrives by merge; `product.<locale>.json` is product-owned
// and its keys win. A missing overlay is an empty table.
function _require(name) {
  try { return require(name); } catch { return {}; }
}

function _load(locale) {
  if (_cache[locale]) return _cache[locale];
  _cache[locale] = { ..._require(`./${locale}.json`), ..._require(`./product.${locale}.json`) };
  return _cache[locale];
}

// Read at call time, not require time: APP_URL is set per deployment and the
// suites pin it in tests/env.js before anything else loads, but a test may
// still vary it, and a parse per call is nothing next to sending an email.
function siteHost() {
  const raw = process.env.APP_URL || 'https://www.orangesmiley.is';
  try {
    return new URL(raw).host.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

function implicitParams() {
  return { siteName: identity.brand.name, legalName: identity.brand.legalName, siteHost: siteHost() };
}

/** Does the table for `locale` (or its fallback) carry `key`? t() returns
 *  the key itself for a missing string, which a caller building optional
 *  copy (a meta description a page may not have) cannot tell from text. */
function has(locale, key) {
  if (!locale || !SUPPORTED_LOCALES.includes(locale)) locale = DEFAULT_LOCALE;
  return _load(locale)[key] !== undefined || _load(DEFAULT_LOCALE)[key] !== undefined;
}

function t(locale, key, params) {
  if (!locale || !SUPPORTED_LOCALES.includes(locale)) locale = DEFAULT_LOCALE;

  const msgs     = _load(locale);
  const fallback = locale !== DEFAULT_LOCALE ? _load(DEFAULT_LOCALE) : msgs;

  let msg = msgs[key] ?? fallback[key] ?? key;

  const all = { ...implicitParams(), ...(params || {}) };
  for (const [k, v] of Object.entries(all)) {
    // A replacer function: a param value is inserted as is, so `$&`, `$'`
    // and friends in a name or a config string are never expanded.
    msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v ?? ''));
  }
  return msg;
}

module.exports = { t, has, siteHost, implicitParams };
