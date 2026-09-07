// ESM twin of the MINOR_UNITS table in server/utils/fx.js — keep the two in sync.
//
// The books API takes every amount in MINOR units, the way the server stores
// them: ISK has no subunit, so an ISK amount IS its minor amount, while
// "EUR 12.50" travels as 1250 and "USD 20.00" as 2000. A form that lets a
// person type 20 for a USD 20.00 invoice and forwards it raw books USD 0.20 —
// no error, no warning, and the VSK return still looks plausible because boxes
// D and E shrink together. So the conversion happens here, at the edge, and the
// input's step follows the currency (whole krónur, hundredths of anything else).

export const MINOR_UNITS = { ISK: 1, EUR: 100, USD: 100, GBP: 100, DKK: 100 };

export function minorUnitsFor(currency) {
  const c = String(currency || '').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(MINOR_UNITS, c)) {
    throw new RangeError(`Unsupported currency: ${currency}`);
  }
  return MINOR_UNITS[c];
}

// What a person typed, in major units ("20.00"), to the integer minor amount the
// API wants (2000). Math.round absorbs the binary-float residue of 20.00 * 100;
// it must never be asked to round a genuinely fractional minor amount, which is
// why amountStep() below stops the input from producing one.
export function toMinorUnits(amount, currency) {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) {
    throw new RangeError(`Amount is required and must be a number, got: ${amount}`);
  }
  return Math.round(n * minorUnitsFor(currency));
}

// The <input type="number"> step for a currency: 1 for ISK, 0.01 otherwise.
export function amountStep(currency) {
  return minorUnitsFor(currency) === 1 ? '1' : '0.01';
}
