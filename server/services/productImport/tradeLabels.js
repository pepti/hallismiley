// Harvested from icelandicstore salesReport/tradeLabels.js (ice@4694289, harvest-ice-d-2026-09-24),
// moved under productImport/ because the engine has no salesReport/ folder.
// Labelled identifiers on a generated trade document — a buyer's purchase order,
// a supplier's order confirmation. Such a document does not put OUR code in a
// column: the column holds the other party's article number, and ours is
// introduced by a label ("Your material number 77005"), with the shared code
// being the GTIN. Both the products import (productImport/parseFile) and the
// Invoice Merger's document reader (salesReport/parseLineItemPdf) read the same
// labels, so they live here — a leaf module with no requires, which is what
// keeps parsePdf → parseLineItemPdf → (this) free of the require cycle that
// importing productImport/parseFile (which itself requires parsePdf) would make.

const BARCODE_MIN = 8;        // GTIN-8 …
const BARCODE_MAX = 14;       // … through GTIN-14 (UPC-12 and ISBN-10 included)

const LABEL_SKU = /\b(?:your\s+(?:material|article|item|product)\s+(?:number|no\.?)|sku|vörunúmer|vörunr\.?)\b\s*[:.]?\s*([\p{L}\p{N}][\p{L}\p{N}._/-]{1,63})/iu;
const LABEL_BARCODE = /\b(?:ean(?:[\s-]?13)?|upc|gtin|barcode|strikamerki)\b[^\p{N}]{0,40}(\p{N}[\p{N}\s-]{6,24})/iu;

// Codes come out of spreadsheets as numbers often enough to be worth cleaning: a
// 13-digit GTIN in a numeric cell can read back as "4001234567890.0", and people
// type barcodes with spaces or dashes.
function cleanCode(value, { digitsOnly = false } = {}) {
  let s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  if (digitsOnly && /^[\d\s-]+$/.test(s)) s = s.replace(/[\s-]/g, '');
  return s;
}

function hasDigit(s) {
  return /\p{N}/u.test(s);
}

// A labelled code read out of running text keeps the sentence's punctuation:
// "Vörunúmer QA0913-A2. Hlýir vettlingar" captured "QA0913-A2." (QA 2026-09-13).
// Only TRAILING sentence punctuation goes — an inner dot, dash or slash
// ("AB.12-3/4") is part of the code.
function stripSentencePunctuation(code) {
  return String(code == null ? '' : code).replace(/[.,;:)]+$/u, '');
}

// The labelled SKU on one line, cleaned, or '' — a code must carry a digit and be
// at least two characters, which is what stops a table HEADER ("SKU  Description")
// from reading as sku = "Description".
function labelledSku(line) {
  const hit = String(line == null ? '' : line).match(LABEL_SKU);
  if (!hit) return '';
  const code = stripSentencePunctuation(hit[1]);
  return code.length >= 2 && hasDigit(code) ? cleanCode(code) : '';
}

// The labelled barcode on one line, digits only, or '' when absent or when the
// page geometry glued two codes together (over-length is dropped, never guessed).
function labelledBarcode(line) {
  const hit = String(line == null ? '' : line).match(LABEL_BARCODE);
  if (!hit) return '';
  const code = cleanCode(hit[1], { digitsOnly: true });
  return code.length >= BARCODE_MIN && code.length <= BARCODE_MAX ? code : '';
}

module.exports = {
  LABEL_SKU,
  LABEL_BARCODE,
  BARCODE_MIN,
  BARCODE_MAX,
  cleanCode,
  hasDigit,
  stripSentencePunctuation,
  labelledSku,
  labelledBarcode,
};
