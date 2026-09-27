// VSK (Icelandic VAT) arithmetic for DISPLAY — the browser twin of
// server/utils/vat.js (splitVatInclusive, allocateProportional) plus the
// per-line rate rule of server/services/bookkeeping/invoiceService.js
// (buildLines / isExport). Pure module, no DOM.
//
// Why (ported from icelandicstore #51, 2026-08): the cart, the checkout and the
// admin order page said "Price includes 24% VAT" as a fixed sentence, but a
// product can be 0, 11 or 24 %, and an order shipped abroad is zero-rated. They
// now show the VAT actually inside the total, per rate, computed the same way
// the invoice will book it — tests/unit/vatDisplay.client.test.js holds this
// file to server/utils/vat.js and to invoiceService.buildLines.
//
// Prices here are VAT-INCLUSIVE gross integers in the currency's minor unit
// (ISK krónur, EUR cents). VAT is extracted, never added. The invoice converts
// a EUR order to ISK before splitting; for a EUR order these figures are the
// same split in cents, which can differ from the ISK invoice by a rounding.

export const ALLOWED_RATES = [0, 11, 24];
export const STANDARD_VAT_RATE = 24;

// A product row's rate for display. The column is NOT NULL DEFAULT 24 with a
// CHECK (0, 11, 24); anything else (a basket line stored before lines carried
// a rate) reads as the standard rate, like invoiceService's absent-rate rule.
export function normaliseRate(rate) {
  const n = Number(rate);
  return rate !== null && rate !== undefined && rate !== '' && ALLOWED_RATES.includes(n) ? n : STANDARD_VAT_RATE;
}

// Twin of server/utils/vat.js splitVatInclusive for valid input: vat is derived
// and net is the remainder, so net + vat === gross exactly.
export function splitVatInclusive(gross, rate) {
  const g = Math.round(Number(gross) || 0);
  const r = normaliseRate(rate);
  if (r === 0) return { net: g, vat: 0, gross: g, rate: 0 };
  const vat = Math.round((g * r) / (100 + r));
  return { net: g - vat, vat, gross: g, rate: r };
}

// Twin of server/utils/vat.js allocateProportional: distribute `total` across
// `weights` so the parts sum EXACTLY to total (largest-remainder method).
export function allocateProportional(total, weights) {
  const t = Math.round(Number(total) || 0);
  const w = weights.map((x) => Math.round(Number(x) || 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const out = new Array(w.length).fill(0);
  if (t === 0) return out;
  if (sum === 0) {
    if (out.length) out[0] = t;
    return out;
  }
  const sign = t < 0 ? -1 : 1;
  const abs = Math.abs(t);
  const exact = w.map((x) => (abs * x) / sum);
  const floored = exact.map((x) => Math.floor(x));
  let remainder = abs - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = floored.slice();
  for (let k = 0; remainder > 0; k = (k + 1) % order.length) {
    result[order[k].i] += 1;
    remainder -= 1;
  }
  return result.map((x) => x * sign);
}

// Twin of invoiceService.isExport: Iceland is outside the EU VAT area, so goods
// shipped abroad are zero-rated. No country (local pickup) means Iceland.
export function isExport(country) {
  const c = String(country || 'IS').trim().toUpperCase();
  return !(c === 'IS' || c === 'ISL' || c === 'ICELAND' || c === 'ÍSLAND');
}

// Twin of buildLines' vatRateFor: an exported GOOD is 0 %; a service is taxed
// where it is performed and keeps its rate; otherwise the product's own rate.
export function lineVatRate({ rate, isService = false } = {}, exportSale = false) {
  if (exportSale && !isService) return 0;
  return normaliseRate(rate);
}

/**
 * The VAT inside an order's total, per rate, split the way the invoice books
 * it (invoiceService.buildLines): each line's gross, then shipping (24 % at
 * home, 0 % on an export), then any gap between those and what is charged
 * (`total`) taken off the lines in proportion — a discount — or added as a
 * rounding line at the largest line's rate. Each line is split on its own and
 * the parts summed, never the sum split.
 *
 * lines: [{ gross, rate, isService }]  (gross = unit price × quantity)
 * Returns [{ rate, vat, gross }] for every rate present, highest rate first,
 * with zero-rated groups kept (so an export says "VSK 0 %: 0 kr.").
 */
export function vatBreakdown({ lines = [], shipping = 0, total, exportSale = false } = {}) {
  const rates = lines.map((l) => lineVatRate(l, exportSale));
  const grossBefore = lines.map((l) => Math.round(Number(l.gross) || 0));
  const shippingGross = Math.max(0, Math.round(Number(shipping) || 0));
  if (shippingGross > 0) {
    grossBefore.push(shippingGross);
    rates.push(exportSale ? 0 : STANDARD_VAT_RATE);
  }
  const sumBefore = grossBefore.reduce((a, b) => a + b, 0);
  const charged = total === undefined || total === null ? sumBefore : Math.round(Number(total) || 0);
  const spread = sumBefore - charged;
  const alloc = spread > 0 ? allocateProportional(spread, grossBefore) : grossBefore.map(() => 0);

  const parts = grossBefore.map((before, i) => {
    const gross = before - Math.min(alloc[i], before);
    return { rate: rates[i], ...splitVatInclusive(gross, rates[i]) };
  });
  if (spread < 0 && parts.length) {
    const dominant = parts.reduce((best, p) => (p.gross > best.gross ? p : best), parts[0]);
    parts.push({ ...splitVatInclusive(-spread, dominant.rate) });
  }

  const byRate = new Map();
  for (const p of parts) {
    const cur = byRate.get(p.rate) || { rate: p.rate, vat: 0, gross: 0 };
    cur.vat += p.vat;
    cur.gross += p.gross;
    byRate.set(p.rate, cur);
  }
  return [...byRate.values()].sort((a, b) => b.rate - a.rate);
}
