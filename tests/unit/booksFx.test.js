// Foreign-currency translation into ISK. The books are ISK-only by law
// (bókhaldslög gr. 10a), so every EUR order has to be translated — and the
// translated lines still have to sum to the translated total, or the invoice
// fails its own consistency constraint.
const {
  convertToIsk,
  convertLinesToIsk,
  assertPlausibleRate,
  assertSupportedCurrency,
  FxError,
  MINOR_UNITS,
} = require('../../server/utils/fx');

describe('assertSupportedCurrency', () => {
  it('accepts the currencies this shop actually uses', () => {
    expect(assertSupportedCurrency('ISK')).toBe('ISK');
    expect(assertSupportedCurrency('eur')).toBe('EUR');
  });

  it('rejects anything else rather than guessing a minor-unit factor', () => {
    expect(() => assertSupportedCurrency('JPY')).toThrow(FxError);
    expect(() => assertSupportedCurrency('')).toThrow(FxError);
  });
});

describe('assertPlausibleRate', () => {
  // A rate typed as 1.5 instead of 150 would understate revenue a hundredfold and
  // pass every other check in the system, so the band exists to catch exactly that.
  it('accepts a realistic EUR/ISK rate', () => {
    expect(assertPlausibleRate('EUR', 150)).toBe(150);
    expect(assertPlausibleRate('EUR', 142.75)).toBe(142.75);
  });

  it('rejects a rate that looks like a decimal-place mistake', () => {
    expect(() => assertPlausibleRate('EUR', 1.5)).toThrow(/plausible range/);
    expect(() => assertPlausibleRate('EUR', 15000)).toThrow(/plausible range/);
  });

  it.each([0, -150, NaN, Infinity, 'abc', null])('rejects invalid rate %p', (bad) => {
    expect(() => assertPlausibleRate('EUR', bad)).toThrow(FxError);
  });

  it('insists ISK has a rate of exactly 1', () => {
    expect(assertPlausibleRate('ISK', 1)).toBe(1);
    expect(() => assertPlausibleRate('ISK', 150)).toThrow(/reporting currency/);
  });
});

describe('convertToIsk', () => {
  it('converts EUR cents to whole ISK', () => {
    // EUR 12.50 at 150 ISK/EUR = 1,875 ISK
    expect(convertToIsk(1250, 'EUR', 150)).toBe(1875);
  });

  it('passes ISK amounts through untouched, since ISK has no subunit', () => {
    expect(MINOR_UNITS.ISK).toBe(1);
    expect(convertToIsk(4990, 'ISK', 1)).toBe(4990);
  });

  it('rounds to a whole króna', () => {
    // EUR 0.01 at 142.75 = 1.4275 ISK -> 1
    expect(convertToIsk(1, 'EUR', 142.75)).toBe(1);
    // EUR 0.07 at 142.75 = 9.99 ISK -> 10
    expect(convertToIsk(7, 'EUR', 142.75)).toBe(10);
  });

  it('refuses to convert an ISK amount at a non-1 rate', () => {
    expect(() => convertToIsk(1000, 'ISK', 150)).toThrow(FxError);
  });
});

describe('convertLinesToIsk', () => {
  // The invariant that matters: converting each line and converting the total
  // independently disagree by a few ISK of rounding. An invoice whose lines do not
  // sum to its total is not a valid document, so the converted total wins and the
  // residual is spread proportionally.
  it('produces lines that sum exactly to the converted total', () => {
    const { lines, total } = convertLinesToIsk([333, 333, 334], 'EUR', 142.75, 1000);
    expect(lines.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('holds that invariant across many rates and line shapes', () => {
    const shapes = [[100], [100, 200], [333, 333, 334], [1, 1, 1, 1, 1], [99999, 1], [2500, 2500, 4999]];
    for (const rate of [120, 142.75, 150.5, 178.99]) {
      for (const shape of shapes) {
        const sum = shape.reduce((a, b) => a + b, 0);
        const { lines, total } = convertLinesToIsk(shape, 'EUR', rate, sum);
        expect(lines.reduce((a, b) => a + b, 0)).toBe(total);
        expect(lines.every(v => v >= 0)).toBe(true);
        expect(lines).toHaveLength(shape.length);
      }
    }
  });

  it('reports the residual it had to redistribute', () => {
    const { residual } = convertLinesToIsk([333, 333, 334], 'EUR', 142.75, 1000);
    expect(Number.isInteger(residual)).toBe(true);
    expect(Math.abs(residual)).toBeLessThan(10);
  });

  it('reconciles ISK lines to an explicit total without touching the rate', () => {
    // The same reconciliation runs for ISK orders, because an order-level discount
    // allocated across lines can also leave a one-króna residual.
    const { lines, total } = convertLinesToIsk([500, 500], 'ISK', 1, 999);
    expect(total).toBe(999);
    expect(lines.reduce((a, b) => a + b, 0)).toBe(999);
  });

  it('falls back to the largest line when proportional spreading would go negative', () => {
    // Contrived but reachable: a big negative residual against tiny lines.
    const { lines, total } = convertLinesToIsk([1000, 1], 'ISK', 1, 500);
    expect(lines.reduce((a, b) => a + b, 0)).toBe(total);
    expect(lines.every(v => v >= 0)).toBe(true);
  });
});
