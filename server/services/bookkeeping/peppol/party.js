// What a BUYER party needs to be addressable — written once, asked by two
// callers, DIRECTION-NEUTRAL like identifiers.js.
//
// The two callers ask the same question at different moments:
//   - accountsController, of a customer_accounts row, BEFORE an invoice exists,
//     so the admin can see what is missing while it is still editable; and
//   - conformance.check(), of the frozen snapshot on an issued invoice, at
//     export time, when the only remaining answer is to refuse.
//
// If those two ever drift, the screen says "ready" and the export says 409 —
// which is precisely the experience this module exists to prevent. Hence one
// function, one set of problem CODES, and both callers normalising into the
// same shape rather than each testing the columns it happens to have.
//
// The codes are the contract. The client turns them into Icelandic under
// `accounts.peppol.<CODE>`; conformance returns them verbatim in its 409.

const { countryCode, digits } = require('./identifiers');

/**
 * @param {object} p normalised party — see buyerOfAccount / buyerOfInvoice
 * @returns {Array<{code, field, message}>} empty when the party is addressable
 */
function buyerPartyProblems(p = {}) {
  const problems = [];
  const add = (code, field, message) => problems.push({ code, field, message });
  const str = v => String(v == null ? '' : v).trim();

  // BR-07 (RegistrationName) and BT-47. A business invoice that does not
  // identify its buyer is not one the buyer can deduct input VAT on.
  if (!str(p.name)) {
    add('BUYER_NAME_MISSING', 'customer_name', 'The buyer has no name.');
  }
  // BG-8 as PARTS. The printed one-line address cannot be parsed back into
  // them — that is the whole reason migration 095 added the structured columns.
  if (!str(p.street) || !str(p.city) || !str(p.postalZone)) {
    add('BUYER_ADDRESS_INCOMPLETE', 'customer_address',
      'The buyer has no structured postal address (street, postal code and city are all required).');
  }
  // BR-11: the buyer country is mandatory, and it is the one address part with
  // no sensible default — guessing IS for a foreign buyer would be worse than
  // refusing, because it silently changes the VAT treatment of the document.
  if (!countryCode(p.country)) {
    add('BUYER_COUNTRY_INVALID', 'customer_country',
      `"${str(p.country) || '(empty)'}" is not a two-letter ISO 3166-1 country code.`);
  }
  // BT-49, mandatory in Peppol (not in the EN 16931 core). An explicit endpoint
  // wins; otherwise an Icelandic kennitala IS the electronic address under
  // 0196, which is how the seller side already works.
  if (!str(p.endpointId) && digits(p.kennitala).length !== 10) {
    add('BUYER_ENDPOINT_MISSING', 'customer_endpoint_id',
      'The buyer has no electronic address and no kennitala to derive one from (0196).');
  }
  return problems;
}

/** A customer_accounts row → the shape buyerPartyProblems expects. */
function buyerOfAccount(account = {}) {
  return {
    name: account.name,
    kennitala: account.kennitala,
    street: account.street,
    city: account.city,
    postalZone: account.postal_zone,
    country: account.country,
    endpointScheme: account.endpoint_scheme,
    endpointId: account.endpoint_id,
    vatNumber: account.vat_number,
  };
}

/** An invoices row (the frozen snapshot) → the same shape. */
function buyerOfInvoice(invoice = {}) {
  return {
    name: invoice.customer_name,
    kennitala: invoice.customer_kennitala,
    street: invoice.customer_street,
    city: invoice.customer_city,
    postalZone: invoice.customer_postal_zone,
    country: invoice.customer_country,
    endpointScheme: invoice.customer_endpoint_scheme,
    endpointId: invoice.customer_endpoint_id,
    vatNumber: invoice.customer_vat_number,
  };
}

// The statutory minimum to ISSUE at all, which is a strictly smaller question
// than "can this be transmitted over Peppol". A missing postal code must never
// stop the company invoicing; a missing kennitala must, because the buyer
// cannot deduct the input VAT on a document that does not identify them.
// (Reglugerð nr. 50/1993 4. gr. — the working reading; see ACCOUNTANT-QUESTIONS.)
function invoiceableProblems(account = {}) {
  const problems = [];
  if (!String(account.name == null ? '' : account.name).trim()) {
    problems.push({ code: 'BUYER_NAME_MISSING', field: 'name', message: 'The account has no name.' });
  }
  if (digits(account.kennitala).length !== 10) {
    problems.push({
      code: 'BUYER_KENNITALA_MISSING', field: 'kennitala',
      message: 'The account has no kennitala. An invoice to a business must identify the buyer.',
    });
  }
  return problems;
}

module.exports = { buyerPartyProblems, buyerOfAccount, buyerOfInvoice, invoiceableProblems };
