'use strict';

const DEFAULT_LOCALE    = process.env.DEFAULT_LOCALE    || 'en';
const SUPPORTED_LOCALES = (process.env.SUPPORTED_LOCALES || 'en,is')
  .split(',').map(l => l.trim()).filter(Boolean);

module.exports = { DEFAULT_LOCALE, SUPPORTED_LOCALES };
