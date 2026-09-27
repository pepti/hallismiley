'use strict';

// The delivery price is ONE rule in two places (harvest2-lane7a, ported from
// icelandicstore #151): server/config/shipping.js computeShippingPrice charges
// it (createCheckoutSession), public/js/utils/shipping.js shows it (cart +
// checkout, fed the rates by GET /shop/config). Change one, change the other —
// this suite fails when they disagree anywhere on the grid.

const server = require('../../server/config/shipping');
const client = require('../../public/js/utils/shipping.js');

const RATE_SETS = [
  { flatRateIsk: 2500, flatRateEur: 1900, freeOverIsk: 0 },
  { flatRateIsk: 1500, flatRateEur: 1100, freeOverIsk: 10000 },
  { flatRateIsk: 0,    flatRateEur: 0,    freeOverIsk: 5000 },
  { flatRateIsk: 990,  flatRateEur: 700,  freeOverIsk: 1 },
];
const SUBTOTALS = [0, 1, 4999, 5000, 5001, 9999, 10000, 10001, 250000];

describe('computeShippingPrice — client twin == server', () => {
  test.each(RATE_SETS)('agrees for every method, currency and basket (%j)', (rates) => {
    for (const method of ['flat_rate', 'local_pickup']) {
      for (const currency of ['ISK', 'EUR']) {
        for (const iskSubtotal of SUBTOTALS) {
          expect(client.computeShippingPrice({ method, currency, rates, iskSubtotal }))
            .toBe(server.computeShippingPrice({ method, currency, rates, iskSubtotal }));
        }
      }
    }
  });

  test('the rule itself: pickup free, free AT the threshold, the currency\'s own flat rate', () => {
    const rates = RATE_SETS[1];
    expect(server.computeShippingPrice({ method: 'local_pickup', currency: 'ISK', rates, iskSubtotal: 1 })).toBe(0);
    expect(server.computeShippingPrice({ method: 'flat_rate', currency: 'ISK', rates, iskSubtotal: 9999 })).toBe(1500);
    expect(server.computeShippingPrice({ method: 'flat_rate', currency: 'ISK', rates, iskSubtotal: 10000 })).toBe(0);
    expect(server.computeShippingPrice({ method: 'flat_rate', currency: 'EUR', rates, iskSubtotal: 9999 })).toBe(1100);
    expect(server.computeShippingPrice({ method: 'flat_rate', currency: 'EUR', rates, iskSubtotal: 10000 })).toBe(0);
  });

  test('both refuse an unknown method or currency', () => {
    for (const impl of [server, client]) {
      expect(() => impl.computeShippingPrice({ method: 'drone', currency: 'ISK', rates: RATE_SETS[0], iskSubtotal: 0 })).toThrow();
      expect(() => impl.computeShippingPrice({ method: 'flat_rate', currency: 'USD', rates: RATE_SETS[0], iskSubtotal: 0 })).toThrow();
    }
  });
});

describe('ratesFromConfig — the /shop/config shape → the rates the rule reads', () => {
  test('maps the getConfig shipping block, tolerating a missing threshold', () => {
    expect(client.ratesFromConfig({
      flat_rate: { priceIsk: 1500, priceEur: 1100 }, local_pickup: { priceIsk: 0, priceEur: 0 }, free_over_isk: 10000,
    })).toEqual({ flatRateIsk: 1500, flatRateEur: 1100, freeOverIsk: 10000 });
    // The checkout's built-in fallback before /shop/config answers.
    expect(client.ratesFromConfig({ flat_rate: { priceIsk: 2500, priceEur: 1900 } }))
      .toEqual({ flatRateIsk: 2500, flatRateEur: 1900, freeOverIsk: 0 });
    expect(client.ratesFromConfig(null)).toEqual({ flatRateIsk: 0, flatRateEur: 0, freeOverIsk: 0 });
  });
});
