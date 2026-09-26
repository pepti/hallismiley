// The VAT inside an order — ONE rule, shared by the checkout snapshot and the
// invoice (harvest 2 lane 5, 2026-09-26).
//
// Before this module the rule lived only inside
// services/bookkeeping/invoiceService.buildLines, so the only place an order's
// VAT existed was its invoice. The sales report needs net sales for every paid
// order, invoiced or not, so the checkout now snapshots the same figure
// (migration 121: order_items.vat_rate, orders.vat_total). Pure: no database,
// no clock, integers in, integers out — utils/vat.js does every split.
//
// What it decides (the rule buildLines always applied, moved here verbatim):
//   * each line at its product's own rate — a missing rate is the standard
//     24 %, an unknown one throws (resolveVatRate), never a quiet 0 %;
//   * an EXPORT zero-rates goods, while a service keeps its rate (VSK act
//     art. 12: a service is taxed where it is performed);
//   * shipping is a line of its own at 24 %, or 0 % on an export (it follows
//     the goods);
//   * the gap between the lines and what the customer actually paid (`total`)
//     is spread over every line INCLUDING shipping, in proportion to its gross
//     (largest remainder — allocateProportional), so each line keeps its
//     effective rate; a shortfall (only a translated order's unit rounding
//     makes one) becomes an explicit rounding line at the rate of the largest
//     line.
//
// Amounts are minor units of ONE currency. The invoice calls this AFTER
// translating to ISK; the checkout calls it in the order's own currency, so
// for an ISK order the two are the same numbers and the snapshot equals the
// booked VAT. For EUR the snapshot is in cents, and the invoice's ISK figure
// depends on the FX rate at the payment date.
//
// Line ORDER matters: the largest-remainder allocation breaks ties by
// position. The checkout therefore computes over the order_items rows in the
// order the invoice reads them (created_at, id) — Order.createWithItems.

const {
  splitVatInclusive, allocateProportional, resolveVatRate, STANDARD_VAT_RATE,
} = require('./vat');

// Iceland is not in the EU VAT area, so a sale shipped abroad is an export and
// zero-rated — but only against proof of export. Anything shipped within
// Iceland, and any service, stays at the standard rate.
function isExport(customerCountry) {
  const c = String(customerCountry || 'IS').trim().toUpperCase();
  return !(c === 'IS' || c === 'ISL' || c === 'ICELAND' || c === 'ÍSLAND');
}

// The country an order's shipping address names, as the invoice snapshots it
// (invoiceService.pickCustomer): the code, else the name, else Iceland — a
// pickup order has no address and is a domestic sale.
function countryOf(address) {
  const addr = address && typeof address === 'object' ? address : null;
  return (addr && addr.country_code) || (addr && addr.country) || 'IS';
}

// The rate one line is sold at.
function lineVatRate({ vat_rate: rate, is_service: isService }, exportSale) {
  if (exportSale && !isService) return 0;
  return rate === null || rate === undefined ? STANDARD_VAT_RATE : resolveVatRate(rate);
}

/**
 * @param {object}   o
 * @param {Array}    o.lines      [{ unit, quantity, vat_rate, is_service }] — unit
 *                                price (VAT inclusive) × quantity is the line gross
 * @param {number}   o.shipping   shipping actually charged before the order
 *                                discount (shipping − shipping_discount), ≥ 0
 * @param {number}   o.total      what the customer paid (the authoritative figure)
 * @param {boolean}  o.exportSale
 * @returns {{ lines: Array, shipping: object|null, rounding: object|null,
 *             vat_total: number, gross_total: number }}
 *   each line / shipping: { vat_rate, gross_before_discount, discount_gross,
 *   line_gross, line_net, line_vat }; rounding: { vat_rate, line_gross,
 *   line_net, line_vat, dominant } where `dominant` is the index into
 *   [...lines, shipping] of the line whose rate it took (-1 for none).
 */
function computeOrderVat({ lines, shipping = 0, total, exportSale = false }) {
  const grossBefore = lines.map(l => l.unit * l.quantity);
  if (shipping > 0) grossBefore.push(shipping);

  const spread = grossBefore.reduce((a, b) => a + b, 0) - total;
  const discountAlloc = spread > 0
    ? allocateProportional(spread, grossBefore)
    : grossBefore.map(() => 0);
  const roundingGross = spread < 0 ? -spread : 0;

  const fit = (i, vatRate) => {
    const before = grossBefore[i];
    const discount = Math.min(discountAlloc[i], before);
    const gross = before - discount;
    const split = splitVatInclusive(gross, vatRate);
    return {
      vat_rate: vatRate,
      gross_before_discount: before,
      discount_gross: discount,
      line_gross: gross,
      line_net: split.net,
      line_vat: split.vat,
    };
  };

  const outLines = lines.map((l, i) => fit(i, lineVatRate(l, exportSale)));
  const outShipping = shipping > 0
    ? fit(grossBefore.length - 1, exportSale ? 0 : STANDARD_VAT_RATE)
    : null;

  let rounding = null;
  if (roundingGross > 0) {
    const all = outShipping ? [...outLines, outShipping] : outLines;
    let dominant = all.length ? 0 : -1;
    all.forEach((l, i) => { if (l.line_gross > all[dominant].line_gross) dominant = i; });
    const vatRate = dominant >= 0 ? all[dominant].vat_rate : STANDARD_VAT_RATE;
    const split = splitVatInclusive(roundingGross, vatRate);
    rounding = { vat_rate: vatRate, line_gross: roundingGross, line_net: split.net, line_vat: split.vat, dominant };
  }

  const every = [...outLines, ...(outShipping ? [outShipping] : []), ...(rounding ? [rounding] : [])];
  return {
    lines: outLines,
    shipping: outShipping,
    rounding,
    vat_total: every.reduce((a, l) => a + l.line_vat, 0),
    gross_total: every.reduce((a, l) => a + l.line_gross, 0),
  };
}

module.exports = { computeOrderVat, lineVatRate, isExport, countryOf };
