/**
 * The Peppol BIS Billing 3.0 emitter (server/services/bookkeeping/peppol/), against a
 * fixture invoice shaped like Invoice.findDetail(). No database.
 *
 * Three things a real receiver would bounce and a totals-only test would miss:
 *   - 11% must be category S at 11 — not "AA" (the classic reduced-rate mistake);
 *   - every amount must satisfy the EN 16931 arithmetic (BR-CO-10/13/15/16/17), with the
 *     books' per-line rounding stated as BT-114 rather than hidden in a total;
 *   - an Icelandic party must be identified under ICD 0196, and the VSK number under
 *     the chosen BT-31 encoding.
 * The document is parsed back with fast-xml-parser (devDependency) so the assertions are
 * about structure, not string positions.
 */
const { XMLParser } = require('fast-xml-parser');
const peppol = require('../../server/services/bookkeeping/peppol');
const ids = require('../../server/services/bookkeeping/peppol/identifiers');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, removeNSPrefix: true });
const parse = xml => parser.parse(xml).Invoice;
const val = node => (node && typeof node === 'object' ? node['#text'] : node);

// A domestic invoice: a two-unit 24% line, an 11% line, and a discounted 24% line.
//   line 1: 2 × 6.200 gross → 12.400 → net 10.000, VAT 2.400
//   line 2: 1 × 1.110 gross (11%) → net 1.000, VAT 110
//   line 3: 9.900 gross before a 990 discount → 8.910 → VAT round(8910·24/124) = 1.725, net 7.185
// Books: net 18.185, VAT 4.235, gross 22.420.
// EN 16931 per rate: S/24 taxable 17.185 → 4.124; S/11 taxable 1.000 → 110; total 4.234.
// So BT-114 = 22.420 − (18.185 + 4.234) = 1, and PayableAmount is still 22.420.
function domesticInvoice(over = {}) {
  return {
    id: 'inv-1', series: 'invoice', invoice_number: 42, status: 'issued', order_id: 'order-9',
    issued_at: '2026-09-01', due_at: '2026-09-15', terms_days: 14, currency: 'ISK',
    seller_name: 'Orange Smiley ehf.', seller_kennitala: '4708261500', seller_vat_number: '162561',
    seller_address: 'Arnarhraun 4\n220 Hafnarfjörður',
    seller_street: 'Arnarhraun 4', seller_city: 'Hafnarfjörður', seller_postal_zone: '220', seller_country: 'IS',
    customer_name: 'Þór & Synir <ehf>', customer_kennitala: '1203894599', customer_email: 'thor@example.is',
    customer_address: 'Bæjargata 5\n101 Reykjavík', customer_country: 'Ísland',
    customer_street: 'Bæjargata 5', customer_city: 'Reykjavík', customer_postal_zone: '101',
    customer_endpoint_scheme: null, customer_endpoint_id: null,
    subtotal_net: 18185, vat_total: 4235, total_gross: 22420, discount_total: 990, shipping_gross: 0,
    amount_paid: 0, amount_credited: 0, amount_refunded: 0, outstanding: 22420,
    zero_rate_reason: null, note: 'Þessi reikningur er rafrænt ytra frumgagn.',
    lines: [
      { id: 'l1', sku: 'SKU-1', description: 'Ráðgjöf', quantity: 2, unit_price_gross: 6200, vat_rate: 24,
        gross_before_discount: 12400, discount_gross: 0, line_net: 10000, line_vat: 2400, line_gross: 12400, sort_order: 0 },
      { id: 'l2', sku: null, description: 'Bók', quantity: 1, unit_price_gross: 1110, vat_rate: 11,
        gross_before_discount: 1110, discount_gross: 0, line_net: 1000, line_vat: 110, line_gross: 1110, sort_order: 1 },
      { id: 'l3', sku: 'SKU-3', description: 'Uppsetning', quantity: 1, unit_price_gross: 9900, vat_rate: 24,
        gross_before_discount: 9900, discount_gross: 990, line_net: 7185, line_vat: 1725, line_gross: 8910, sort_order: 2 },
    ],
    vat_by_rate: [{ rate: 11, net: 1000, vat: 110, gross: 1110 }, { rate: 24, net: 17185, vat: 4125, gross: 21310 }],
    payments: [], credit_notes: [],
    ...over,
  };
}

const settings = { seller_endpoint_scheme: '0196', seller_endpoint_id: '', seller_iban: 'IS140159260076545510730339', seller_bic: 'NBIIISRE' };

describe('buildUblInvoice — header and parties', () => {
  const built = peppol.buildUblInvoice({ invoice: domesticInvoice(), settings });
  const doc = parse(built.xml);

  test('is a Peppol BIS Billing 3.0 invoice in ISK', () => {
    expect(built.ready).toBe(true);
    expect(built.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    // removeNSPrefix drops the xmlns attributes from the parsed tree, so the
    // namespace is asserted on the bytes.
    expect(built.xml).toContain('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
    expect(built.xml).toContain('xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"');
    expect(built.xml).toContain('xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"');
    expect(doc.CustomizationID).toBe(ids.CUSTOMIZATION_ID);
    expect(doc.ProfileID).toBe(ids.PROFILE_ID);
    expect(doc.ID).toBe('42');
    expect(doc.IssueDate).toBe('2026-09-01');
    expect(doc.DueDate).toBe('2026-09-15');
    expect(doc.InvoiceTypeCode).toBe('380');
    expect(doc.DocumentCurrencyCode).toBe('ISK');
    expect(doc.UBLVersionID).toBeUndefined(); // BIS 3.0: should not be present
    expect(doc.OrderReference.ID).toBe('order-9');
  });

  test('identifies the seller by kennitala under ICD 0196 and the VSK number with the IS prefix', () => {
    const p = doc.AccountingSupplierParty.Party;
    expect(p.EndpointID['@schemeID']).toBe('0196');
    expect(val(p.EndpointID)).toBe('4708261500');
    expect(p.PartyLegalEntity.CompanyID['@schemeID']).toBe('0196');
    expect(val(p.PartyLegalEntity.CompanyID)).toBe('4708261500');
    expect(p.PartyLegalEntity.RegistrationName).toBe('Orange Smiley ehf.');
    expect(p.PartyTaxScheme.CompanyID).toBe('IS162561');
    expect(p.PartyTaxScheme.TaxScheme.ID).toBe('VAT');
    expect(p.PostalAddress).toMatchObject({ StreetName: 'Arnarhraun 4', CityName: 'Hafnarfjörður', PostalZone: '220' });
    expect(p.PostalAddress.Country.IdentificationCode).toBe('IS');
  });

  test('the buyer: structured address, normalised country, kennitala, and escaped name', () => {
    const p = doc.AccountingCustomerParty.Party;
    expect(p.PartyName.Name).toBe('Þór & Synir <ehf>');
    expect(built.xml).toContain('Þór &amp; Synir &lt;ehf&gt;');
    expect(p.PostalAddress.Country.IdentificationCode).toBe('IS'); // from "Ísland"
    expect(p.PartyLegalEntity.CompanyID['@schemeID']).toBe('0196');
    expect(val(p.PartyLegalEntity.CompanyID)).toBe('1203894599');
    expect(p.EndpointID).toBeUndefined(); // no Peppol address recorded for this buyer
    expect(p.Contact.ElectronicMail).toBe('thor@example.is');
  });

  test('payment means from the settings', () => {
    expect(doc.PaymentMeans.PaymentMeansCode).toBe('30');
    expect(doc.PaymentMeans.PayeeFinancialAccount.ID).toBe('IS140159260076545510730339');
    expect(doc.PaymentMeans.PayeeFinancialAccount.FinancialInstitutionBranch.ID).toBe('NBIIISRE');
  });
});

describe('buildUblInvoice — VAT categories and arithmetic', () => {
  const invoice = domesticInvoice();
  const built = peppol.buildUblInvoice({ invoice, settings });
  const doc = parse(built.xml);
  const subtotals = doc.TaxTotal.TaxSubtotal;
  const byPct = Object.fromEntries(subtotals.map(s => [s.TaxCategory.Percent, s]));

  test('one TaxSubtotal per rate; 11% is category S at 11, NOT "AA"', () => {
    expect(subtotals).toHaveLength(2);
    expect(byPct['24'].TaxCategory.ID).toBe('S');
    expect(byPct['11'].TaxCategory.ID).toBe('S');
    expect(byPct['11'].TaxCategory.ID).not.toBe('AA');
    expect(byPct['11'].TaxCategory.TaxScheme.ID).toBe('VAT');
  });

  test('BR-CO-17: each TaxAmount = round(TaxableAmount × rate)', () => {
    expect(val(byPct['24'].TaxableAmount)).toBe('17185.00');
    expect(val(byPct['24'].TaxAmount)).toBe('4124.00');
    expect(val(byPct['11'].TaxableAmount)).toBe('1000.00');
    expect(val(byPct['11'].TaxAmount)).toBe('110.00');
    expect(val(doc.TaxTotal.TaxAmount)).toBe('4234.00'); // BR-CO-14
    expect(doc.TaxTotal.TaxAmount['@currencyID']).toBe('ISK');
  });

  test('the books’ per-line rounding is stated as BT-114, and PayableAmount is what the customer owes', () => {
    const m = doc.LegalMonetaryTotal;
    expect(val(m.LineExtensionAmount)).toBe('18185.00'); // BT-106 = Σ BT-131 (BR-CO-10)
    expect(val(m.TaxExclusiveAmount)).toBe('18185.00');  // BT-109 (BR-CO-13, no doc-level allowances)
    expect(val(m.TaxInclusiveAmount)).toBe('22419.00');  // BT-112 = 109 + 110 (BR-CO-15)
    expect(val(m.AllowanceTotalAmount)).toBe('0.00');
    expect(val(m.PrepaidAmount)).toBe('0.00');
    expect(val(m.PayableRoundingAmount)).toBe('1.00');   // BT-114: books VAT 4.235 vs rule VAT 4.234
    expect(val(m.PayableAmount)).toBe('22420.00');       // BT-115 = 112 − 113 + 114 (BR-CO-16)
    expect(built.notes.some(n => /BT-114/.test(n))).toBe(true);
  });

  test('every amount has two decimals and the ISK currency', () => {
    const amounts = built.xml.match(/currencyID="ISK">[^<]+</g);
    expect(amounts.length).toBeGreaterThan(10);
    for (const a of amounts) expect(a).toMatch(/currencyID="ISK">-?\d+\.\d{2}</);
  });

  test('lines: price for the whole quantity so PriceAmount × Qty ÷ BaseQty − allowance = BT-131 exactly', () => {
    const lines = doc.InvoiceLine;
    expect(lines).toHaveLength(3);

    const l1 = lines[0];
    expect(l1.ID).toBe('1');
    expect(val(l1.InvoicedQuantity)).toBe('2');
    expect(l1.InvoicedQuantity['@unitCode']).toBe('C62');
    expect(val(l1.LineExtensionAmount)).toBe('10000.00');
    expect(val(l1.Price.PriceAmount)).toBe('10000.00');
    expect(val(l1.Price.BaseQuantity)).toBe('2');
    expect(l1.AllowanceCharge).toBeUndefined();
    expect(l1.Item.SellersItemIdentification.ID).toBe('SKU-1');
    expect(l1.Item.ClassifiedTaxCategory).toMatchObject({ ID: 'S', Percent: '24' });

    // The discounted line: gross-before 9.900 → net-before round: VAT 1.916, net 7.984;
    // allowance = 7.984 − 7.185 = 799; 7.984 × 1 ÷ 1 − 799 = 7.185 = BT-131.
    const l3 = lines[2];
    expect(val(l3.LineExtensionAmount)).toBe('7185.00');
    expect(val(l3.Price.PriceAmount)).toBe('7984.00');
    expect(l3.AllowanceCharge.ChargeIndicator).toBe('false');
    expect(val(l3.AllowanceCharge.Amount)).toBe('799.00');
    // Element order inside InvoiceLine: AllowanceCharge before Item, Price last.
    const idx = s => built.xml.indexOf(s, built.xml.indexOf('<cbc:ID>3</cbc:ID>'));
    expect(idx('<cac:AllowanceCharge>')).toBeLessThan(idx('<cac:Item>'));
    expect(idx('<cac:Item>')).toBeLessThan(idx('<cac:Price>'));
  });
});

describe('buildUblInvoice — an export', () => {
  test('0% with an export reason is category G with the VATEX-EU-G reason code', () => {
    const inv = domesticInvoice({
      customer_country: 'DK', customer_city: 'København', customer_postal_zone: '1050', customer_street: 'Strøget 1',
      zero_rate_reason: 'Útflutningur — sala til útlanda, 0% VSK. Krefst útflutningsgagna.',
      subtotal_net: 12400, vat_total: 0, total_gross: 12400, discount_total: 0, outstanding: 12400,
      lines: [{ id: 'l1', sku: null, description: 'Vara', quantity: 2, unit_price_gross: 6200, vat_rate: 0,
        gross_before_discount: 12400, discount_gross: 0, line_net: 12400, line_vat: 0, line_gross: 12400, sort_order: 0 }],
      vat_by_rate: [{ rate: 0, net: 12400, vat: 0, gross: 12400 }],
    });
    const built = peppol.buildUblInvoice({ invoice: inv, settings });
    expect(built.ready).toBe(true);
    const doc = parse(built.xml);
    const st = doc.TaxTotal.TaxSubtotal;
    expect(st.TaxCategory.ID).toBe('G');
    expect(st.TaxCategory.Percent).toBe('0');
    expect(st.TaxCategory.TaxExemptionReasonCode).toBe('VATEX-EU-G');
    expect(st.TaxCategory.TaxExemptionReason).toMatch(/Útflutningur/);
    expect(val(doc.TaxTotal.TaxAmount)).toBe('0.00');
    expect(doc.LegalMonetaryTotal.PayableRoundingAmount).toBeUndefined();
    expect(doc.AccountingCustomerParty.Party.PostalAddress.Country.IdentificationCode).toBe('DK');
  });
});

describe('conformance — refusals by code', () => {
  const codes = inv => peppol.check({ invoice: inv }).problems.map(p => p.code);

  test('a well-formed issued invoice is ready', () => {
    expect(peppol.check({ invoice: domesticInvoice() })).toMatchObject({ ready: true, problems: [] });
  });

  test.each([
    ['NOT_ISSUED', { status: 'draft' }],
    ['NOT_ISSUED', { status: 'cancelled' }],
    ['RECEIPT_SERIES', { series: 'receipt' }],
    ['NO_LINES', { lines: [] }],
    ['SELLER_INCOMPLETE', { seller_vat_number: '' }],
    ['SELLER_ADDRESS_INCOMPLETE', { seller_street: null }],
    ['BUYER_ADDRESS_INCOMPLETE', { customer_postal_zone: null }],
    ['BUYER_COUNTRY_INVALID', { customer_country: 'XYZ' }],
    ['ZERO_RATE_WITHOUT_REASON', { lines: [{ ...domesticInvoice().lines[0], vat_rate: 0, line_vat: 0, line_net: 12400 }], zero_rate_reason: null }],
  ])('%s', (code, over) => {
    expect(codes(domesticInvoice(over))).toContain(code);
    expect(peppol.buildUblInvoice({ invoice: domesticInvoice(over), settings }).ready).toBe(false);
  });

  test('a pre-095 row (every structured part NULL) is refused by name, never parsed from the printed address', () => {
    const inv = domesticInvoice({
      seller_street: null, seller_city: null, seller_postal_zone: null, seller_country: null,
      customer_street: null, customer_city: null, customer_postal_zone: null,
    });
    const c = codes(inv);
    expect(c).toEqual(expect.arrayContaining(['SELLER_ADDRESS_INCOMPLETE', 'BUYER_ADDRESS_INCOMPLETE']));
  });

  test('more than a few krónur between per-line VAT and per-rate VAT is a refusal, not a rounding line', () => {
    const inv = domesticInvoice({ vat_total: 4335, total_gross: 22520, outstanding: 22520 });
    expect(codes(inv)).toContain('VAT_ROUNDING_DRIFT');
  });

  test('credit notes are a note, not a refusal', () => {
    const r = peppol.check({ invoice: domesticInvoice({ amount_credited: 1110 }) });
    expect(r.ready).toBe(true);
    expect(r.notes.some(n => /Credit notes/.test(n))).toBe(true);
  });
});

describe('identifiers — direction-neutral', () => {
  test('country normalisation copes with every spelling the invoices table already holds', () => {
    for (const raw of ['IS', 'is', 'ISL', 'Ísland', 'ICELAND']) expect(ids.countryCode(raw)).toBe('IS');
    expect(ids.countryCode('DK')).toBe('DK');
    expect(ids.countryCode('Danmörk')).toBeNull();
    expect(ids.countryCode('')).toBeNull();
  });

  test('a kennitala is a legal entity id under 0196; anything else is not', () => {
    expect(ids.legalEntityId('120389-4599')).toEqual({ schemeID: '0196', value: '1203894599' });
    expect(ids.legalEntityId('12345')).toBeNull();
  });

  test('the endpoint defaults to the kennitala under 0196 and can be overridden by the access point', () => {
    expect(ids.endpointId({ kennitala: '4708261500' })).toEqual({ schemeID: '0196', value: '4708261500' });
    expect(ids.endpointId({ scheme: '0088', id: '5790000000000' })).toEqual({ schemeID: '0088', value: '5790000000000' });
    expect(ids.endpointId({})).toBeNull();
  });

  test('the checksum is over the exact bytes served', () => {
    const built = peppol.buildUblInvoice({ invoice: domesticInvoice(), settings });
    const crypto = require('crypto');
    expect(built.checksum).toBe(crypto.createHash('sha256').update(built.xml, 'utf8').digest('hex'));
    expect(built.byteSize).toBe(Buffer.byteLength(built.xml, 'utf8'));
  });
});
