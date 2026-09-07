/**
 * public/js/utils/money.js is the ESM twin of the MINOR_UNITS table in
 * server/utils/fx.js. The expense form converts what a person typed (major
 * units) into what the API stores (minor units) — this pins that the form's
 * conversion and the server's translation agree, by round-tripping a typed
 * amount through the real convertToIsk().
 *
 * The defect this guards: the form used to send Number(field) raw, so a
 * USD 20.00 Azure invoice typed as 20 booked as USD 0.20 ≈ 27 kr instead of
 * ≈ 2.778 kr, silently, with a plausible-looking VSK return.
 * babel-jest compiles the ESM module to CJS for require() (see slug.client.test.js).
 */
const { MINOR_UNITS, toMinorUnits, amountStep, minorUnitsFor } = require('../../public/js/utils/money.js');
const { convertToIsk } = require('../../server/utils/fx');

describe('public/js/utils/money.js', () => {
  test('USD 20.00 at 138.90 books as 2.778 ISK, not 27', () => {
    const minor = toMinorUnits('20.00', 'USD');
    expect(minor).toBe(2000);
    expect(convertToIsk(minor, 'USD', 138.9)).toBe(2778);
  });

  test('EUR 100.00 at 150 → 15.000 ISK (the existing server-side fixture)', () => {
    expect(convertToIsk(toMinorUnits('100', 'EUR'), 'EUR', 150)).toBe(15000);
  });

  test('ISK is its own minor unit — a typed króna amount passes through unchanged', () => {
    expect(toMinorUnits('12400', 'ISK')).toBe(12400);
    expect(convertToIsk(toMinorUnits('12400', 'ISK'), 'ISK', 1)).toBe(12400);
  });

  test('binary-float residue is absorbed: 19.99 * 100 is an integer 1999', () => {
    expect(toMinorUnits('19.99', 'USD')).toBe(1999);
    expect(toMinorUnits(0.07, 'EUR')).toBe(7);
  });

  test('every foreign currency converts consistently with the server', () => {
    // The server refuses ISK at any rate but 1 (there is nothing to translate), so
    // ISK is pinned separately above; every subunit currency goes through the rate.
    for (const cur of Object.keys(MINOR_UNITS).filter(c => c !== 'ISK')) {
      // 1 major unit at rate 100 → 100 ISK regardless of subunit convention.
      expect(convertToIsk(toMinorUnits('1', cur), cur, 100)).toBe(100);
    }
  });

  test('the input step follows the currency', () => {
    expect(amountStep('ISK')).toBe('1');
    for (const cur of ['EUR', 'USD', 'GBP', 'DKK']) expect(amountStep(cur)).toBe('0.01');
  });

  test('refuses what the server refuses: missing, empty, non-numeric, unknown currency', () => {
    expect(() => toMinorUnits('', 'ISK')).toThrow(RangeError);
    expect(() => toMinorUnits(null, 'ISK')).toThrow(RangeError);
    expect(() => toMinorUnits('abc', 'ISK')).toThrow(RangeError);
    expect(() => toMinorUnits('10', 'CHF')).toThrow(RangeError);
    expect(() => minorUnitsFor('')).toThrow(RangeError);
  });
});
