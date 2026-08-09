// Foreign-currency translation into ISK.
//
// Bókhaldslög 145/1994 gr. 10a: the books are kept in ISK. This site sells in
// both ISK and EUR, so every EUR document has to be translated — and translated
// at the rate of ITS OWN transaction date, not at whatever the rate happens to be
// when someone gets round to invoicing. Using "today's rate" for a three-month-old
// order silently misstates the period it belongs to.
//
// The rate is therefore looked up per date from the fx_rates table (populated by
// server/scripts/books-fetch-fx.js from the Central Bank of Iceland, or entered
// by hand) and STORED on the document, so the translation stays auditable years
// later even if the rate table is rebuilt.

const { assertIntegerIsk, allocateProportional, VatError } = require('./vat');

// Minor units per major unit, by currency. ISK has no subunit at all — 1 ISK is
// one unit — which is why an ISK "amount" and an ISK "minor amount" are the same
// number, while EUR amounts are in cents.
const MINOR_UNITS = { ISK: 1, EUR: 100, USD: 100, GBP: 100, DKK: 100 };

// A sanity band, not a business rule. EUR/ISK has traded roughly 120-180 for
// years; anything outside this is a typo or a broken feed (a rate entered as
// "1.5" instead of "150" would otherwise understate revenue 100-fold).
const PLAUSIBLE_RATE = { EUR: [50, 500], USD: [50, 500], GBP: [50, 600], DKK: [5, 100] };

class FxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FxError';
    this.status = 400;
  }
}

function assertSupportedCurrency(currency) {
  const c = String(currency || '').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(MINOR_UNITS, c)) {
    throw new FxError(`Unsupported currency: ${currency}`);
  }
  return c;
}

// Reject an implausible rate loudly rather than booking a 100x error.
function assertPlausibleRate(currency, rate) {
  const c = assertSupportedCurrency(currency);
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) {
    throw new FxError(`FX rate must be a positive number, got: ${rate}`);
  }
  if (c === 'ISK' && r !== 1) {
    throw new FxError('ISK is the reporting currency; its rate must be exactly 1');
  }
  const band = PLAUSIBLE_RATE[c];
  if (band && (r < band[0] || r > band[1])) {
    throw new FxError(
      `FX rate ${r} for ${c} is outside the plausible range ${band[0]}-${band[1]}; ` +
      'check whether the rate was entered per unit of foreign currency in ISK'
    );
  }
  return r;
}

// Convert an amount in a currency's minor units into whole ISK.
//   convertToIsk(1250, 'EUR', 150) -> 1875   (EUR 12.50 at 150 ISK/EUR)
//   convertToIsk(1250, 'ISK', 1)   -> 1250   (already ISK, no subunit)
function convertToIsk(minorAmount, currency, rate) {
  const c = assertSupportedCurrency(currency);
  const amount = assertIntegerIsk(minorAmount, 'minorAmount');
  if (c === 'ISK') {
    if (Number(rate) !== 1) throw new FxError('ISK amounts must be converted at rate 1');
    return amount;
  }
  const r = assertPlausibleRate(c, rate);
  return Math.round((amount * r) / MINOR_UNITS[c]);
}

// Convert a set of line amounts and reconcile them to a converted total.
//
// Converting each line independently and converting the total independently give
// answers that differ by a few ISK of rounding. An invoice whose lines do not sum
// to its total is not a valid document, so the target total is authoritative and
// the residual is redistributed across the lines in proportion to their size
// (largest-remainder), never dumped onto whichever line happens to be last.
//
// Returns { lines, total, residual } where lines sum exactly to total.
function convertLinesToIsk(lineMinorAmounts, currency, rate, explicitTotalMinor) {
  const c = assertSupportedCurrency(currency);
  const lines = lineMinorAmounts.map((x, i) => assertIntegerIsk(x, `line[${i}]`));
  if (c === 'ISK') {
    const total = explicitTotalMinor === undefined
      ? lines.reduce((a, b) => a + b, 0)
      : assertIntegerIsk(explicitTotalMinor, 'explicitTotalMinor');
    return { lines: reconcile(lines, total), total, residual: total - lines.reduce((a, b) => a + b, 0) };
  }
  const r = assertPlausibleRate(c, rate);
  const converted = lines.map(x => Math.round((x * r) / MINOR_UNITS[c]));
  const sourceTotal = explicitTotalMinor === undefined
    ? lines.reduce((a, b) => a + b, 0)
    : assertIntegerIsk(explicitTotalMinor, 'explicitTotalMinor');
  const target = Math.round((sourceTotal * r) / MINOR_UNITS[c]);
  const residual = target - converted.reduce((a, b) => a + b, 0);
  return { lines: reconcile(converted, target), total: target, residual };
}

// Nudge `parts` so they sum to `target`, spreading the difference proportionally.
function reconcile(parts, target) {
  const sum = parts.reduce((a, b) => a + b, 0);
  const diff = target - sum;
  if (diff === 0) return parts.slice();
  const spread = allocateProportional(diff, parts.map(p => Math.abs(p)));
  const out = parts.map((p, i) => p + spread[i]);
  // A negative line would be a nonsensical invoice row; if the spread pushed one
  // below zero, fall back to putting the whole difference on the largest line,
  // which is guaranteed to absorb it.
  if (out.some(v => v < 0)) {
    const largest = parts.reduce((best, p, i) => (p > parts[best] ? i : best), 0);
    const fallback = parts.slice();
    fallback[largest] += diff;
    if (fallback[largest] < 0) {
      throw new VatError('Cannot reconcile converted lines to the target total without a negative line');
    }
    return fallback;
  }
  return out;
}

module.exports = {
  MINOR_UNITS,
  FxError,
  assertSupportedCurrency,
  assertPlausibleRate,
  convertToIsk,
  convertLinesToIsk,
};
