// Peppol / EN 16931 for the books. Outbound today (a BIS Billing 3.0 invoice from
// an issued invoice); inbound reuses identifiers.js and vatCategory.js when it
// lands, so the two directions share one answer to "how is an Icelandic party
// identified" and "which category is 11%".
const identifiers = require('./identifiers');
const conformance = require('./conformance');
const { buildUblInvoice } = require('./ublInvoice');
const { categoryFor, computeTotals } = require('./vatCategory');

module.exports = {
  identifiers,
  check: conformance.check,
  buildUblInvoice,
  categoryFor,
  computeTotals,
};
