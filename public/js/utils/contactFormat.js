// Client twin of server/utils/contactFormat.js — the SAME phone and Icelandic
// postcode rules, so a form can point at the field before the server refuses
// the save. tests/unit/contactFormat.test.js runs both through one corpus.
// Ported from icelandicstore #399.

export const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;
export const IS_ZIP_RE = /^\d{3}$/;

export function isValidPhone(v) {
  return typeof v === 'string' && PHONE_RE.test(v);
}

// The spellings invoiceService.isExport (and utils/vat.js) read as domestic.
const ICELAND = new Set(['', 'IS', 'ISL', 'ICELAND', 'ÍSLAND']);
export function isIcelandic(country) {
  const c = typeof country === 'string' ? country.trim().toUpperCase() : '';
  return ICELAND.has(c);
}

export function isValidZip(zip, country) {
  if (!isIcelandic(country)) return true;
  return IS_ZIP_RE.test(String(zip ?? '').trim());
}
