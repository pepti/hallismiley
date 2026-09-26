'use strict';

// public/js/utils/importMarkup.js — cost + markup → price, and ISK → EUR at a
// typed rate (ported from icelandicstore #314; the EUR half is the engine's).
const {
  parseMarkupPercent, parseEurRate, priceFromCost, eurCentsFromIsk, applyPricing,
  isCostOnlyRow, hasCostOnlyRows, hasEurlessRows,
} = require('../../public/js/utils/importMarkup.js');

describe('parsing', () => {
  test('markup: comma or dot decimals, blank is "no markup", junk and > 1000 % refused', () => {
    expect(parseMarkupPercent(' 80 % ')).toEqual({ ok: true, percent: 80 });
    expect(parseMarkupPercent('12,5')).toEqual({ ok: true, percent: 12.5 });
    expect(parseMarkupPercent('')).toEqual({ ok: true, percent: null });
    expect(parseMarkupPercent('abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMarkupPercent('1001')).toEqual({ ok: false, reason: 'too_high' });
  });
  test('EUR rate: ISK per euro inside 50–500', () => {
    expect(parseEurRate('149,5')).toEqual({ ok: true, rate: 149.5 });
    expect(parseEurRate('')).toEqual({ ok: true, rate: null });
    expect(parseEurRate('1.5')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseEurRate('9000')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('arithmetic', () => {
  test('12,5 % of 2 490 is 2 801 (integer hundredths, no float drift)', () => {
    expect(priceFromCost('2490', 12.5)).toBe(2801);
    expect(priceFromCost('x', 10)).toBeNull();
  });
  test('ISK → EUR cents', () => {
    expect(eurCentsFromIsk(15000, 150)).toBe(10000);
    expect(eurCentsFromIsk(0, 150)).toBeNull();
  });
});

describe('applyPricing', () => {
  const asRead = [
    { name: 'A', cost_isk: '1000', __ai: true },
    { name: 'B', price_isk: '5000', __ai: true, __uncertain: ['barcode'] },
    { name: 'C', price_isk: '700', price_eur: '500', __ai: true },
    { name: 'D', cost_isk: '1000' }, // not AI-read: never touched
  ];
  test('only AI cost-only rows get a markup price; EUR only where missing; flags added', () => {
    expect(isCostOnlyRow(asRead[0])).toBe(true);
    expect(hasCostOnlyRows(asRead)).toBe(true);
    expect(hasEurlessRows(asRead)).toBe(true);
    const { rows, priced, eurPriced } = applyPricing(asRead, { percent: 50, eurRate: 150 });
    expect(rows[0]).toMatchObject({ price_isk: '1500', price_eur: '1000', __uncertain: ['price', 'price_eur'] });
    expect(rows[1]).toMatchObject({ price_isk: '5000', price_eur: '3333', __uncertain: ['barcode', 'price_eur'] });
    expect(rows[2]).toBe(asRead[2]);
    expect(rows[3]).toBe(asRead[3]);
    expect([priced, eurPriced]).toEqual([1, 2]);
  });
  test('always from the rows as read — changing the markup never compounds', () => {
    const once = applyPricing(asRead, { percent: 80 }).rows;
    const again = applyPricing(asRead, { percent: 60 }).rows;
    expect(once[0].price_isk).toBe('1800');
    expect(again[0].price_isk).toBe('1600');
    expect(asRead[0].price_isk).toBeUndefined();
  });
});
