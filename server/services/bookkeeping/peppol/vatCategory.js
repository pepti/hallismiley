// EN 16931 VAT categories and the document arithmetic for an Icelandic invoice.
//
// TWO THINGS THIS FILE HAS TO GET RIGHT
//
// 1. The category codes. 24% and 11% are BOTH category "S" (standard rated) at
//    different percentages — EN 16931 expresses a reduced rate as S with a lower
//    Percent, not as a separate code. Using "AA" for 11% is the classic
//    reduced-rate mistake and the unit test exists to catch it. A zero-rated
//    EXPORT is "G" (free export item, VAT not charged) and must carry a reason
//    (BR-G-10); that is what invoices.zero_rate_reason has been holding all along.
//
// 2. The rounding. The books extract VAT per LINE from a VAT-inclusive gross
//    (utils/vat.splitVatInclusive) and sum. EN 16931 wants each per-rate VAT
//    amount to equal round2(taxable × rate) (BR-CO-17), and the two can differ by
//    a króna or two on a multi-line invoice. Neither figure is wrong; they are two
//    rounding conventions. The document states the rule-conformant VAT, and the
//    difference between that and what the customer actually owes goes into
//    BT-114 "Payable rounding amount" — the field EN 16931 provides for exactly
//    this — so PayableAmount is the books' figure and nothing is silently altered.
//    A gap larger than a few krónur is not rounding and is refused (conformance.js).

const { splitVatInclusive } = require('../../../utils/vat');

function categoryFor(rate, { zeroRateReason } = {}) {
  const r = Number(rate);
  if (r === 24 || r === 11) return { id: 'S', percent: r };
  if (r === 0) {
    if (zeroRateReason) {
      return { id: 'G', percent: 0, exemptionReasonCode: 'VATEX-EU-G', exemptionReason: String(zeroRateReason) };
    }
    return { id: 'Z', percent: 0 };
  }
  throw new Error(`Unsupported VAT rate for EN 16931: ${rate}`);
}

// A line's net figures for the document.
//
// invoice_lines stores a VAT-INCLUSIVE unit price and an allocated discount, and
// UBL wants a net price. Dividing line_net by quantity is frequently non-terminating,
// and BR-CO-… checks BT-131 = PriceAmount × Quantity ÷ BaseQuantity − allowances. So
// the price is stated for the WHOLE quantity (BaseQuantity = quantity): the product
// is exact by construction, and the allocated discount stays visible as a line
// allowance instead of being folded into the price the customer was quoted — the
// same reason invoice_lines keeps discount_gross out of unit_price_gross.
function lineFigures(line) {
  const rate = Number(line.vat_rate);
  const net = Number(line.line_net);
  const before = Number(line.gross_before_discount);
  let priceNetTotal = splitVatInclusive(before, rate).net;
  let allowance = priceNetTotal - net;
  if (allowance < 0) {
    // Rounding left the pre-discount price a króna short of the net; state the price
    // as the net rather than invent a negative allowance.
    priceNetTotal = net;
    allowance = 0;
  }
  return { rate, net, priceNetTotal, allowance, quantity: Number(line.quantity) };
}

/**
 * Every figure the document states, from an Invoice.findDetail() object.
 * Pure: no rounding decision is hidden in the emitter.
 */
function computeTotals(invoice) {
  const lines = (invoice.lines || []).map((l, i) => ({
    ...lineFigures(l),
    index: i + 1,
    source: l,
    category: categoryFor(l.vat_rate, { zeroRateReason: invoice.zero_rate_reason }),
  }));

  // One TaxSubtotal per (category, percent), BR-CO-17 arithmetic.
  const groups = new Map();
  for (const l of lines) {
    const key = `${l.category.id}:${l.category.percent}`;
    const g = groups.get(key) || { category: l.category, taxable: 0 };
    g.taxable += l.net;
    groups.set(key, g);
  }
  const subtotals = [...groups.values()].map(g => ({
    ...g,
    tax: Math.round((g.taxable * g.category.percent) / 100),
  }));

  const lineExtension = lines.reduce((a, l) => a + l.net, 0);        // BT-106
  // Shipping, discounts and sléttun are all LINES in this ledger, so there are no
  // document-level allowances or charges: BT-107 = BT-108 = 0 and BT-109 = BT-106.
  const taxExclusive = lineExtension;                                 // BT-109
  const taxAmount = subtotals.reduce((a, s) => a + s.tax, 0);         // BT-110
  const taxInclusive = taxExclusive + taxAmount;                      // BT-112
  const prepaid = Number(invoice.amount_paid || 0);                   // BT-113
  const rounding = Number(invoice.total_gross) - taxInclusive;        // BT-114
  const payable = taxInclusive - prepaid + rounding;                  // BT-115 (= total_gross − amount_paid)

  return {
    lines,
    subtotals,
    lineExtension,
    taxExclusive,
    taxAmount,
    taxInclusive,
    prepaid,
    rounding,
    payable,
    booksSubtotalNet: Number(invoice.subtotal_net),
    booksVatTotal: Number(invoice.vat_total),
    booksTotalGross: Number(invoice.total_gross),
  };
}

module.exports = { categoryFor, lineFigures, computeTotals };
