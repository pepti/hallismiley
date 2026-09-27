'use strict';

// The order's VAT has ONE rule (harvest 2 lane 5, migration 121):
// server/utils/orderVat.js computeOrderVat, called by the invoice
// (bookkeeping/invoiceService.buildLines, after translating to ISK) and by the
// checkout snapshot (Order.createWithItems, in the order's own currency).
//
// 1. buildLines must produce EXACTLY what it produced before its core moved:
//    tests/fixtures/buildLinesGolden.json was written by the pre-extraction
//    buildLines over tests/fixtures/buildLinesFixtures.js (ISK and translated
//    EUR orders, discounts, shipping discounts, exports with a service, a
//    rounding line, a 100 % discount). Never regenerate it from new code.
// 2. For an ISK order, the snapshot the checkout would compute equals the VAT
//    the invoice books, line by line.

const { buildLines } = require('../../server/services/bookkeeping/invoiceService');
const { computeOrderVat, isExport, countryOf } = require('../../server/utils/orderVat');
const { CASES } = require('../fixtures/buildLinesFixtures');
const GOLDEN = require('../fixtures/buildLinesGolden.json');

describe('buildLines is unchanged by the extraction', () => {
  test('the golden file covers every fixture', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(CASES.map(c => c.name).sort());
    expect(Object.values(GOLDEN).some(g => g.lines && g.lines.some(l => l.is_rounding))).toBe(true);
    expect(CASES.some(c => c.order.currency === 'EUR')).toBe(true);
  });

  test.each(CASES.map(c => [c.name, c]))('%s', (name, c) => {
    const built = buildLines({ order: c.order, items: c.items, rate: c.rate, exportSale: c.exportSale });
    expect(JSON.parse(JSON.stringify(built))).toEqual(GOLDEN[name]);
  });
});

describe('the checkout snapshot equals the booked VAT (ISK)', () => {
  const iskCases = CASES.filter(c => c.order.currency === 'ISK');

  test.each(iskCases.map(c => [c.name, c]))('%s', (name, c) => {
    const o = c.order;
    const snap = computeOrderVat({
      lines: c.items.map(it => ({
        unit: it.product_price_snapshot, quantity: it.quantity, vat_rate: it.vat_rate, is_service: it.is_service,
      })),
      shipping: Math.max(0, o.shipping - o.shipping_discount),
      total: o.total,
      exportSale: c.exportSale,
    });
    const golden = GOLDEN[name];
    expect(snap.vat_total).toBe(golden.vat_total);
    expect(snap.gross_total).toBe(o.total);
    const goods = golden.lines.filter(l => !l.is_shipping && !l.is_rounding);
    expect(snap.lines.map(l => l.vat_rate)).toEqual(goods.map(l => l.vat_rate));
    expect(snap.lines.map(l => l.line_vat)).toEqual(goods.map(l => l.line_vat));
  });
});

describe('the pure helper', () => {
  test('an export zero-rates goods and shipping; a service keeps its rate', () => {
    const r = computeOrderVat({
      lines: [{ unit: 12400, quantity: 1, vat_rate: 24 }, { unit: 12400, quantity: 1, vat_rate: 24, is_service: true }],
      shipping: 1240, total: 26040, exportSale: true,
    });
    expect(r.lines.map(l => l.vat_rate)).toEqual([0, 24]);
    expect(r.shipping.vat_rate).toBe(0);
    expect(r.vat_total).toBe(2400);
  });

  test('a rate Iceland does not have throws; a missing one is the standard rate', () => {
    expect(() => computeOrderVat({ lines: [{ unit: 100, quantity: 1, vat_rate: 7 }], total: 100 }))
      .toThrow(/Unsupported VAT rate/);
    expect(computeOrderVat({ lines: [{ unit: 124, quantity: 1, vat_rate: null }], total: 124 }).vat_total).toBe(24);
  });

  test('country and export follow the invoice', () => {
    expect(countryOf(null)).toBe('IS');
    expect(countryOf({ country: 'Norway' })).toBe('Norway');
    expect(countryOf({ country_code: 'NO', country: 'Noregur' })).toBe('NO');
    expect(countryOf({ country_code: '', country: '' })).toBe('IS');
    expect(isExport('ísland')).toBe(false);
    expect(isExport('NO')).toBe(true);
  });
});
