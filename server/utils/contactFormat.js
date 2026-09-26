'use strict';

// Phone + Icelandic postcode shapes, shared by every validator that checks a
// person's contact details (signup/profile phone, the contact form, the
// checkout's shipping address). Client twin: public/js/utils/contactFormat.js —
// tests/unit/contactFormat.test.js holds the two to the same corpus.
//
// Ported from icelandicstore #399 (2026-09-21). Trimmed for the engine: ice's
// zipChangeRefused (store-location UPDATES) is left out — the engine has no
// store-location editor.

// E.164-ish: digits, spaces, dashes, dots, parentheses, an optional leading +.
// The same rule validate.js has always applied to the signup/profile phone; it
// is deliberately not an Icelandic-only rule (a buyer abroad has a foreign
// number).
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

// An Icelandic postnúmer is exactly three digits (101, 600, 900). Other
// countries' postcodes are free text (the caller's length cap still applies).
const IS_ZIP_RE = /^\d{3}$/;

function isValidPhone(v) {
  return typeof v === 'string' && PHONE_RE.test(v);
}

// Blank country means Iceland: the forms default to IS. The spellings are the
// ones bookkeeping/invoiceService.isExport reads as domestic, so the postcode
// rule and the VAT export rule can never disagree about where "Iceland" is.
const ICELAND = new Set(['', 'IS', 'ISL', 'ICELAND', 'ÍSLAND']);
function isIcelandic(country) {
  const c = typeof country === 'string' ? country.trim().toUpperCase() : '';
  return ICELAND.has(c);
}

// True unless the address is in Iceland and the postcode is not three digits.
// Surrounding whitespace is forgiven ("101 " from a paste).
function isValidZip(zip, country) {
  if (!isIcelandic(country)) return true;
  return IS_ZIP_RE.test(String(zip ?? '').trim());
}

module.exports = { PHONE_RE, IS_ZIP_RE, isValidPhone, isValidZip, isIcelandic };
