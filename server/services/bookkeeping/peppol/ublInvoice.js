// UBL 2.1 Invoice, Peppol BIS Billing 3.0 profile (EN 16931), from an
// Invoice.findDetail() object plus the books settings.
//
// This is a SEMANTIC serialisation with statutory arithmetic rules, which is why
// it is not an extension of bookkeepingPdf.js (a rendering module about fonts
// and column positions). The minimum BIS 3.0 field set and nothing more; the
// element ORDER inside each aggregate is fixed by the UBL schema and is followed
// exactly below. Every decision about codes and rounding lives in identifiers.js
// and vatCategory.js; every refusal lives in conformance.js.

const crypto = require('crypto');
const ids = require('./identifiers');
const { XML_DECLARATION, tag, moneyTag, formatQuantity } = require('./xml');
const { computeTotals } = require('./vatCategory');
const conformance = require('./conformance');

const NS = {
  xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
};

const isoDay = v => String(v || '').slice(0, 10);

function taxCategory(elName, category) {
  return tag(elName, null, [
    tag('cbc:ID', null, category.id),
    tag('cbc:Percent', null, String(category.percent)),
    category.exemptionReasonCode && tag('cbc:TaxExemptionReasonCode', null, category.exemptionReasonCode),
    category.exemptionReason && tag('cbc:TaxExemptionReason', null, category.exemptionReason),
    tag('cac:TaxScheme', null, [tag('cbc:ID', null, 'VAT')]),
  ]);
}

// BG-4 / BG-7. Element order: EndpointID, PartyIdentification, PartyName,
// PostalAddress, PartyTaxScheme, PartyLegalEntity, Contact.
function party({ endpoint, name, street, city, postalZone, country, vatId, legalId, email }) {
  return tag('cac:Party', null, [
    endpoint && tag('cbc:EndpointID', { schemeID: endpoint.schemeID }, endpoint.value),
    tag('cac:PartyName', null, [tag('cbc:Name', null, name)]),
    tag('cac:PostalAddress', null, [
      tag('cbc:StreetName', null, street),
      tag('cbc:CityName', null, city),
      tag('cbc:PostalZone', null, postalZone),
      tag('cac:Country', null, [tag('cbc:IdentificationCode', null, country)]),
    ]),
    vatId && tag('cac:PartyTaxScheme', null, [
      tag('cbc:CompanyID', null, vatId),
      tag('cac:TaxScheme', null, [tag('cbc:ID', null, 'VAT')]),
    ]),
    tag('cac:PartyLegalEntity', null, [
      tag('cbc:RegistrationName', null, name),
      legalId && tag('cbc:CompanyID', { schemeID: legalId.schemeID }, legalId.value),
    ]),
    email && tag('cac:Contact', null, [tag('cbc:ElectronicMail', null, email)]),
  ]);
}

/**
 * @returns {{ ready: boolean, problems, notes, xml?, checksum?, byteSize?, customizationId?, totals? }}
 */
function buildUblInvoice({ invoice, settings = {} }) {
  const pre = conformance.check({ invoice });
  if (!pre.ready) return { ready: false, problems: pre.problems, notes: pre.notes };

  const cur = ids.ISK;
  const totals = computeTotals(invoice);
  const sellerCountry = ids.countryCode(invoice.seller_country);
  const buyerCountry = ids.countryCode(invoice.customer_country);

  const supplier = party({
    endpoint: ids.endpointId({
      scheme: settings.seller_endpoint_scheme, id: settings.seller_endpoint_id, kennitala: invoice.seller_kennitala,
    }),
    name: invoice.seller_name,
    street: invoice.seller_street,
    city: invoice.seller_city,
    postalZone: invoice.seller_postal_zone,
    country: sellerCountry,
    vatId: ids.vatId(invoice.seller_vat_number, sellerCountry),
    legalId: ids.legalEntityId(invoice.seller_kennitala),
  });

  const customer = party({
    // BT-49, mandatory in Peppol (PEPPOL-EN16931-R010). This used to emit null
    // whenever customer_endpoint_id was unset — which was ALWAYS, because
    // nothing in the codebase wrote that column, so every document we produced
    // claimed BIS 3.0 conformance while missing a mandatory field. An explicit
    // endpoint wins; otherwise the kennitala IS the address under 0196, exactly
    // as on the seller side.
    endpoint: ids.endpointId({
      scheme: invoice.customer_endpoint_scheme,
      id: invoice.customer_endpoint_id,
      kennitala: invoice.customer_kennitala,
    }),
    name: invoice.customer_name,
    street: invoice.customer_street,
    city: invoice.customer_city,
    postalZone: invoice.customer_postal_zone,
    country: buyerCountry,
    // BT-48. Absent on a domestic sale (24% is category S and needs no buyer
    // VAT id) and present for reverse charge, where BR-AE-* requires it.
    // Routed through the same VAT_ID_ENCODING constant as the seller, so the
    // two parties can never be encoded differently.
    vatId: ids.vatId(invoice.customer_vat_number, buyerCountry),
    legalId: ids.legalEntityId(invoice.customer_kennitala),
    email: invoice.customer_email || null,
  });

  const iban = String(settings.seller_iban || '').trim();
  const bic = String(settings.seller_bic || '').trim();

  const invoiceLines = totals.lines.map((l) => tag('cac:InvoiceLine', null, [
    tag('cbc:ID', null, String(l.index)),
    tag('cbc:InvoicedQuantity', { unitCode: ids.UNIT_CODE }, formatQuantity(l.quantity)),
    moneyTag('cbc:LineExtensionAmount', l.net, cur),
    l.allowance > 0 && tag('cac:AllowanceCharge', null, [
      tag('cbc:ChargeIndicator', null, 'false'),
      tag('cbc:AllowanceChargeReason', null, 'Afsláttur'),
      moneyTag('cbc:Amount', l.allowance, cur),
    ]),
    tag('cac:Item', null, [
      tag('cbc:Name', null, l.source.description),
      l.source.sku && tag('cac:SellersItemIdentification', null, [tag('cbc:ID', null, l.source.sku)]),
      taxCategory('cac:ClassifiedTaxCategory', l.category),
    ]),
    tag('cac:Price', null, [
      moneyTag('cbc:PriceAmount', l.priceNetTotal, cur),
      // Price stated for the whole quantity: PriceAmount × Quantity ÷ BaseQuantity
      // is then exact by construction (see vatCategory.lineFigures).
      tag('cbc:BaseQuantity', { unitCode: ids.UNIT_CODE }, formatQuantity(l.quantity)),
    ]),
  ]));

  const body = tag('Invoice', NS, [
    tag('cbc:CustomizationID', null, ids.CUSTOMIZATION_ID),
    tag('cbc:ProfileID', null, ids.PROFILE_ID),
    tag('cbc:ID', null, String(invoice.invoice_number)),
    tag('cbc:IssueDate', null, isoDay(invoice.issued_at)),
    tag('cbc:DueDate', null, isoDay(invoice.due_at)),
    tag('cbc:InvoiceTypeCode', null, ids.INVOICE_TYPE_CODE),
    invoice.note && tag('cbc:Note', null, invoice.note),
    tag('cbc:DocumentCurrencyCode', null, cur),
    // PEPPOL-EN16931-R003: a buyer reference or an order reference is required.
    invoice.order_id
      ? tag('cac:OrderReference', null, [tag('cbc:ID', null, invoice.order_id)])
      : tag('cbc:BuyerReference', null, String(invoice.invoice_number)),
    tag('cac:AccountingSupplierParty', null, [supplier]),
    tag('cac:AccountingCustomerParty', null, [customer]),
    iban && tag('cac:PaymentMeans', null, [
      tag('cbc:PaymentMeansCode', null, '30'),
      tag('cbc:PaymentID', null, String(invoice.invoice_number)),
      tag('cac:PayeeFinancialAccount', null, [
        tag('cbc:ID', null, iban),
        bic && tag('cac:FinancialInstitutionBranch', null, [tag('cbc:ID', null, bic)]),
      ]),
    ]),
    tag('cac:PaymentTerms', null, [
      tag('cbc:Note', null, `Greiðslufrestur ${invoice.terms_days} dagar`),
    ]),
    tag('cac:TaxTotal', null, [
      moneyTag('cbc:TaxAmount', totals.taxAmount, cur),
      ...totals.subtotals.map(s => tag('cac:TaxSubtotal', null, [
        moneyTag('cbc:TaxableAmount', s.taxable, cur),
        moneyTag('cbc:TaxAmount', s.tax, cur),
        taxCategory('cac:TaxCategory', s.category),
      ])),
    ]),
    tag('cac:LegalMonetaryTotal', null, [
      moneyTag('cbc:LineExtensionAmount', totals.lineExtension, cur),
      moneyTag('cbc:TaxExclusiveAmount', totals.taxExclusive, cur),
      moneyTag('cbc:TaxInclusiveAmount', totals.taxInclusive, cur),
      moneyTag('cbc:AllowanceTotalAmount', 0, cur),
      moneyTag('cbc:PrepaidAmount', totals.prepaid, cur),
      totals.rounding !== 0 && moneyTag('cbc:PayableRoundingAmount', totals.rounding, cur),
      moneyTag('cbc:PayableAmount', totals.payable, cur),
    ]),
    ...invoiceLines,
  ]);

  const xml = `${XML_DECLARATION}\n${body}\n`;
  return {
    ready: true,
    problems: [],
    notes: pre.notes,
    xml,
    byteSize: Buffer.byteLength(xml, 'utf8'),
    checksum: crypto.createHash('sha256').update(xml, 'utf8').digest('hex'),
    customizationId: ids.CUSTOMIZATION_ID,
    profile: 'peppol-bis-billing-3.0',
    totals,
  };
}

module.exports = { buildUblInvoice };
