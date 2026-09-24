'use strict';

// public/js/utils/format.js — the locale-aware money/number formatter most admin
// views use (order builder, invoices, books …).
//
// QA 2026-09-13: the Icelandic order builder showed "ISK 8,400". The formatter
// asked Intl for 'is-IS', and a browser whose ICU data lacks Icelandic silently
// hands back en-US. Icelandic output is now built by hand, so it no longer
// depends on what the runtime's ICU happens to contain.

const RealNumberFormat = Intl.NumberFormat;
// ICU puts a no-break space between the amount and the unit; so does the formatter.
const kr = (amount) => `${amount}${String.fromCharCode(0xa0)}kr.`;

function load(locale) {
  jest.resetModules();
  global.window = { __locale: locale };
  return require('../../public/js/utils/format.js');
}

afterEach(() => {
  Intl.NumberFormat = RealNumberFormat;
});

afterAll(() => {
  delete global.window;
});

// What a full-ICU runtime gives for is-IS — the hand-built output must agree.
const icuIs = (n, opts) => new RealNumberFormat('is-IS', opts).format(n);

describe('formatMoney in Icelandic', () => {
  test('ISK groups with a period and ends in "kr."', () => {
    const { formatMoney } = load('is');
    expect(formatMoney(8400, 'ISK')).toBe(kr('8.400'));
    expect(formatMoney(1234567, 'ISK')).toBe(kr('1.234.567'));
    expect(formatMoney(999, 'ISK')).toBe(kr('999'));
    expect(formatMoney(0, 'ISK')).toBe(kr('0'));
    expect(formatMoney(-4500, 'ISK')).toBe(kr('-4.500'));
  });

  test('matches full-ICU is-IS output', () => {
    const { formatMoney } = load('is');
    for (const n of [0, 5, 999, 1000, 8400, 45540, 1234567, -8400]) {
      expect(formatMoney(n, 'ISK')).toBe(icuIs(n, { style: 'currency', currency: 'ISK', maximumFractionDigits: 0 }));
    }
    for (const cents of [0, 1250, 123450, 99]) {
      expect(formatMoney(cents, 'EUR')).toBe(icuIs(cents / 100, { style: 'currency', currency: 'EUR' }));
    }
  });

  test('does not depend on the runtime having Icelandic ICU data', () => {
    // Simulate the browser that produced the bug: every locale resolves to en-US.
    Intl.NumberFormat = function (_locale, opts) { return new RealNumberFormat('en-US', opts); };
    const { formatMoney, formatNumber } = load('is');
    expect(formatMoney(8400, 'ISK')).toBe(kr('8.400'));
    expect(formatNumber(12345.5)).toBe('12.345,5');
  });

  test('non-finite input stays empty', () => {
    const { formatMoney } = load('is');
    expect(formatMoney(undefined, 'ISK')).toBe('');
    expect(formatMoney('abc', 'ISK')).toBe('');
  });
});

describe('formatNumber in Icelandic', () => {
  test('matches full-ICU is-IS output', () => {
    const { formatNumber } = load('is');
    for (const n of [0, 7, 1000, 12345.5, 1234.5678, -1234, 0.25]) {
      expect(formatNumber(n)).toBe(icuIs(n));
    }
  });
});

describe('English is unchanged', () => {
  test('still Intl en-GB', () => {
    const { formatMoney, formatNumber } = load('en');
    expect(formatMoney(8400, 'ISK')).toBe(new RealNumberFormat('en-GB', { style: 'currency', currency: 'ISK', maximumFractionDigits: 0 }).format(8400));
    expect(formatNumber(12345.5)).toBe('12,345.5');
  });
});

// An invoice line's unit is line total ÷ qty and is often not whole (sweep
// 2026-09-21): printed rounded, 3 × 1.241 kr sat beside a 3.724 kr total.
describe('formatIskExact — invoice unit price', () => {
  test('Icelandic: two decimals when not whole, identical to formatMoney when whole', () => {
    const { formatIskExact, formatMoney } = load('is');
    expect(formatIskExact(1241.3333)).toBe(kr('1.241,33'));
    expect(formatIskExact(1234567.5)).toBe(kr('1.234.567,50'));
    expect(formatIskExact(2108)).toBe(formatMoney(2108, 'ISK'));
    expect(formatIskExact(2108.001)).toBe(formatMoney(2108, 'ISK')); // rounds to whole
  });

  test('English: ISK with two fraction digits', () => {
    const { formatIskExact } = load('en');
    expect(formatIskExact(1241.33)).toBe(new RealNumberFormat('en-GB', { style: 'currency', currency: 'ISK', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1241.33));
  });
});
