// The preflight: refuse to emit a document a BIS 3.0 receiver would bounce, and
// say why by code — the same posture as vatService.preflight() and the 409s the
// books already return. Nothing here guesses: a missing address part is a
// refusal naming the part, never a parse of the free-text column.

const { countryCode, digits } = require('./identifiers');
const { computeTotals } = require('./vatCategory');

// |BT-114| above this is not two rounding conventions disagreeing; it is an
// invoice whose per-line VAT and totals do not describe the same document.
const MAX_ROUNDING_KR = 3;

/**
 * @returns {{ ready: boolean, problems: Array<{code, field, message}>, notes: string[] }}
 */
function check({ invoice } = {}) {
  const problems = [];
  const notes = [];
  const add = (code, field, message) => problems.push({ code, field, message });

  if (!invoice) {
    add('NOT_ISSUED', 'invoice', 'No invoice');
    return { ready: false, problems, notes };
  }

  if (invoice.series === 'receipt') {
    add('RECEIPT_SERIES', 'series', 'A till receipt has no addressable buyer; Peppol is B2B.');
  }
  if (invoice.status !== 'issued' && invoice.status !== 'credited') {
    add('NOT_ISSUED', 'status', `The invoice is ${invoice.status}; only an issued document can be transmitted.`);
  }
  const lines = invoice.lines || [];
  if (!lines.length) add('NO_LINES', 'lines', 'The invoice has no lines.');

  if (!String(invoice.seller_name || '').trim() || digits(invoice.seller_kennitala).length !== 10
      || !digits(invoice.seller_vat_number)) {
    add('SELLER_INCOMPLETE', 'seller', 'Seller name, kennitala or VSK number missing on the invoice.');
  }
  if (!String(invoice.seller_street || '').trim() || !String(invoice.seller_city || '').trim()
      || !String(invoice.seller_postal_zone || '').trim() || !countryCode(invoice.seller_country)) {
    add('SELLER_ADDRESS_INCOMPLETE', 'seller_address',
      'The invoice carries no structured seller address (issued before migration 095, or the parts were not set in the books settings at issue). It cannot be derived from the printed address.');
  }
  if (!String(invoice.customer_street || '').trim() || !String(invoice.customer_city || '').trim()
      || !String(invoice.customer_postal_zone || '').trim()) {
    add('BUYER_ADDRESS_INCOMPLETE', 'customer_address',
      'The invoice carries no structured buyer address (issued before migration 095, or from an order without one). It cannot be derived from the printed address.');
  }
  if (!countryCode(invoice.customer_country)) {
    add('BUYER_COUNTRY_INVALID', 'customer_country', `"${invoice.customer_country}" is not a two-letter ISO 3166-1 country code.`);
  }
  if (lines.some(l => Number(l.vat_rate) === 0) && !invoice.zero_rate_reason) {
    add('ZERO_RATE_WITHOUT_REASON', 'zero_rate_reason', 'A 0% line needs the export reason (BR-G-10); a domestic 0% line is a data error.');
  }

  // Arithmetic — only meaningful once the structure is sound.
  if (!problems.length) {
    let totals;
    try {
      totals = computeTotals(invoice);
    } catch (err) {
      add('UNSUPPORTED_RATE', 'lines', err.message);
    }
    if (totals) {
      if (totals.lineExtension !== totals.booksSubtotalNet) {
        add('TOTALS_INCONSISTENT', 'subtotal_net',
          `Sum of line nets (${totals.lineExtension}) differs from subtotal_net (${totals.booksSubtotalNet}).`);
      }
      if (Math.abs(totals.rounding) > MAX_ROUNDING_KR) {
        add('VAT_ROUNDING_DRIFT', 'vat_total',
          `Per-rate VAT under EN 16931 rounding (${totals.taxAmount}) is ${totals.rounding} kr. from the books' VAT total (${totals.booksVatTotal}) — more than rounding.`);
      } else if (totals.rounding !== 0) {
        notes.push(`Per-line VAT and EN 16931 per-rate rounding differ by ${totals.rounding} kr.; stated as PayableRoundingAmount (BT-114).`);
      }
    }
  }
  if (Number(invoice.amount_credited || 0) > 0) {
    notes.push('Credit notes are separate documents; this invoice is emitted as issued.');
  }

  return { ready: problems.length === 0, problems, notes };
}

module.exports = { check, MAX_ROUNDING_KR };
