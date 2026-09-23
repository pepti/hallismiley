// Identifiers and codes for Peppol / EN 16931 documents — DIRECTION-NEUTRAL.
//
// The outbound emitter uses this today; the inbound parser will use the same
// module when it lands, so "how is an Icelandic party identified" is written once
// and the two directions cannot drift into slightly different answers.

// ISO 6523 ICD 0196 — the Icelandic kennitala, as listed on the Peppol EAS/ICD
// code lists. This is what makes an Icelandic party addressable at all: without a
// scheme a kennitala is ten digits in a text field.
const ICELAND_ICD = '0196';

const ISK = 'ISK';

// Peppol BIS Billing 3.0 identifiers (BT-24, BT-23) and the invoice type (BT-3).
const CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
const PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';
const INVOICE_TYPE_CODE = '380';

// UN/ECE Recommendation 20 "one (unit)". The neutral choice until product data
// carries a unit of its own; every line is a count of things or of services.
const UNIT_CODE = 'C62';

// How the seller's VSK number is expressed as a VAT identifier (BT-31). EN 16931
// BR-CO-09 wants an ISO 3166-1 country prefix, an EU-VAT assumption; Iceland is
// outside the EU VAT area and its number is a bare 5–6 digits. Two viable
// encodings, behind ONE constant so switching is a one-line change:
//   'prefixed' — emit "IS" + digits under TaxScheme VAT (satisfies BR-CO-09
//                syntactically), AND always emit BT-30 (kennitala, 0196).
//   'omit'     — no BT-31 at all; the seller is identified by BT-30 alone
//                (BR-CO-26 is satisfied by BT-30) and BR-CO-09 has nothing to fire on.
// Which one a real BIS 3.0 receiver accepts for an Icelandic seller is the headline
// question of the cross-implementation test.
const VAT_ID_ENCODING = 'prefixed';

const digits = s => String(s == null ? '' : s).replace(/\D/g, '');

// The codebase already copes with 'IS' | 'ISL' | 'Ísland' | 'ICELAND' in one
// column (invoiceService.isExport). Normalise to alpha-2 or refuse.
function countryCode(raw) {
  const c = String(raw == null ? '' : raw).trim().toUpperCase();
  if (c === 'IS' || c === 'ISL' || c === 'ICELAND' || c === 'ÍSLAND') return 'IS';
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

// BT-30 / BT-47: the party's legal registration identifier.
function legalEntityId(kennitala) {
  const d = digits(kennitala);
  return d.length === 10 ? { schemeID: ICELAND_ICD, value: d } : null;
}

// BT-34 / BT-49: the Peppol participant identifier ("electronic address").
function endpointId({ scheme, id, kennitala } = {}) {
  const value = String(id || '').trim() || digits(kennitala);
  if (!value) return null;
  return { schemeID: String(scheme || '').trim() || ICELAND_ICD, value };
}

// BT-31 / BT-48, per VAT_ID_ENCODING.
function vatId(vatNumber, country) {
  const d = digits(vatNumber);
  if (!d) return null;
  if (VAT_ID_ENCODING === 'omit') return null;
  const c = countryCode(country) || 'IS';
  return `${c}${d}`;
}

module.exports = {
  ICELAND_ICD,
  ISK,
  CUSTOMIZATION_ID,
  PROFILE_ID,
  INVOICE_TYPE_CODE,
  UNIT_CODE,
  VAT_ID_ENCODING,
  digits,
  countryCode,
  legalEntityId,
  endpointId,
  vatId,
};
