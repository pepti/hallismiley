'use strict';
// Server-side i18n helper.
// Usage: const { t } = require('../i18n');
//        t('en', 'email.verify.subject')
//        t('is', 'email.order.subject', { orderNumber: 'ORD-001' })

const { DEFAULT_LOCALE, SUPPORTED_LOCALES } = require('../config/i18n');

const _cache = {};

function _load(locale) {
  if (_cache[locale]) return _cache[locale];
  try {
    _cache[locale] = require(`./${locale}.json`);
  } catch {
    _cache[locale] = {};
  }
  return _cache[locale];
}

function t(locale, key, params) {
  if (!locale || !SUPPORTED_LOCALES.includes(locale)) locale = DEFAULT_LOCALE;

  const msgs     = _load(locale);
  const fallback = locale !== DEFAULT_LOCALE ? _load(DEFAULT_LOCALE) : msgs;

  let msg = msgs[key] ?? fallback[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
    }
  }
  return msg;
}

module.exports = { t };
