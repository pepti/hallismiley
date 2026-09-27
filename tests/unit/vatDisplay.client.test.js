'use strict';

// public/js/utils/vat.js — the VAT the cart, checkout and admin order page
// show per rate (ported from icelandicstore #51). It must say what the invoice
// will book, so it is held here to its two server sources:
//   · server/utils/vat.js (splitVatInclusive, allocateProportional), and
//   · bookkeeping/invoiceService.buildLines (per-line rate, shipping, the
//     discount spread, export zero-rating, the rounding line).

const client = require('../../public/js/utils/vat.js');
const server = require('../../server/utils/vat');
const { buildLines, isExport: serverIsExport } = require('../../server/services/bookkeeping/invoiceService');

describe('splitVatInclusive / allocateProportional — client twin == server', () => {
  const AMOUNTS = [0, 1, 99, 100, 101, 124, 990, 3500, 5200, 20850, 123457, 9999999];
  test.each([0, 11, 24])('split at %i %% agrees for every amount', (rate) => {
    for (const g of AMOUNTS) {
      expect(client.splitVatInclusive(g, rate)).toEqual(server.splitVatInclusive(g, rate));
    }
  });

  test('allocateProportional agrees, and the parts sum to the total', () => {
    const cases = [[10, [1, 1, 1]], [101, [5000, 3000, 2000]], [7, [0, 0]], [0, [3, 4]], [-5, [2, 3]], [1, [990, 990, 990]]];
    for (const [total, weights] of cases) {
      const c = client.allocateProportional(total, weights);
      expect(c).toEqual(server.allocateProportional(total, weights));
      expect(c.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  test('isExport agrees', () => {
    for (const c of ['IS', 'is', 'ISL', 'Ísland', 'ICELAND', '', null, undefined, 'DK', 'GB', 'US']) {
      expect(client.isExport(c)).toBe(serverIsExport(c));
    }
  });

  test('an unknown or missing rate reads as the standard 24 %, like the invoice', () => {
    expect(client.normaliseRate(null)).toBe(24);
    expect(client.normaliseRate(undefined)).toBe(24);
    expect(client.normaliseRate(7)).toBe(24);
    expect(client.normaliseRate('11')).toBe(11);
    expect(client.normaliseRate(0)).toBe(0);
  });
});

// The invoice's per-rate VAT for an ISK order, summed from buildLines' rows.
function invoiceVatByRate({ items, shipping = 0, shippingDiscount = 0, total, exportSale }) {
  const order = { currency: 'ISK', shipping, shipping_discount: shippingDiscount, total };
  const { lines } = buildLines({
    order,
    items: items.map((it, i) => ({
      product_id: `p${i}`, sku: null, product_name_snapshot: `Line ${i}`,
      product_price_snapshot: it.price, quantity: it.qty,
      is_service: !!it.isService, vat_rate: it.rate,
    })),
    rate: null,
    exportSale,
  });
  const byRate = new Map();
  for (const l of lines) {
    const cur = byRate.get(l.vat_rate) || { rate: l.vat_rate, vat: 0, gross: 0 };
    cur.vat += l.line_vat;
    cur.gross += l.line_gross;
    byRate.set(l.vat_rate, cur);
  }
  return [...byRate.values()].sort((a, b) => b.rate - a.rate);
}

function displayVatByRate({ items, shipping = 0, shippingDiscount = 0, total, exportSale }) {
  return client.vatBreakdown({
    lines: items.map(it => ({ gross: it.price * it.qty, rate: it.rate, isService: it.isService })),
    shipping: shipping - shippingDiscount,
    total,
    exportSale,
  });
}

describe('vatBreakdown == invoiceService.buildLines (ISK orders)', () => {
  const CASES = {
    'one standard-rated line': { items: [{ price: 3500, qty: 1, rate: 24 }], total: 3500 },
    'mixed 24 / 11 / 0 with shipping': {
      items: [{ price: 5200, qty: 2, rate: 24 }, { price: 3990, qty: 1, rate: 11 }, { price: 990, qty: 3, rate: 0 }],
      shipping: 2500, total: 5200 * 2 + 3990 + 990 * 3 + 2500,
    },
    'a discount spread across the lines in proportion': {
      items: [{ price: 5200, qty: 2, rate: 24 }, { price: 3990, qty: 1, rate: 11 }],
      shipping: 2500, total: 5200 * 2 + 3990 + 2500 - 1733,
    },
    'free shipping by a shipping discount': {
      items: [{ price: 4000, qty: 1, rate: 24 }], shipping: 2500, shippingDiscount: 2500, total: 4000,
    },
    'export: goods and shipping zero-rated, a service keeps its rate': {
      items: [{ price: 5200, qty: 1, rate: 24 }, { price: 60000, qty: 1, rate: 24, isService: true }],
      shipping: 2500, total: 5200 + 60000 + 2500, exportSale: true,
    },
    'a line with no rate (deleted product) books at 24 %': {
      items: [{ price: 1000, qty: 1, rate: null }, { price: 500, qty: 2, rate: 11 }], total: 2000,
    },
  };

  test.each(Object.entries(CASES))('%s', (_name, c) => {
    expect(displayVatByRate(c)).toEqual(invoiceVatByRate(c));
  });

  test('the cart (no shipping, no total) is the plain per-line split', () => {
    const rows = client.vatBreakdown({ lines: [{ gross: 3500, rate: 24 }, { gross: 1110, rate: 11 }] });
    expect(rows).toEqual([
      { rate: 24, vat: server.splitVatInclusive(3500, 24).vat, gross: 3500 },
      { rate: 11, vat: server.splitVatInclusive(1110, 11).vat, gross: 1110 },
    ]);
  });

  test('an export keeps a 0 % row so the page can say so', () => {
    const rows = client.vatBreakdown({ lines: [{ gross: 5000, rate: 24 }], shipping: 2500, exportSale: true });
    expect(rows).toEqual([{ rate: 0, vat: 0, gross: 7500 }]);
  });
});
