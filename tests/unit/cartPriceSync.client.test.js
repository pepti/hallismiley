'use strict';

// cart.syncPrices — a basket left open across a price change must show what
// checkout will charge. The server re-fetches every price on submit; this only
// copies the payload's prices onto the stored lines and reports which moved,
// so the cart and checkout can tell the customer. Ported from icelandicstore
// #343 (tests/unit/cartPriceSync.client.test.js); the engine version returns
// the repriced lines and also fills in the VSK rate / service flag.

jest.mock('../../public/js/services/auth.js', () => ({ getUser: () => ({ id: 'buyer-1' }) }));

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
global.window = { dispatchEvent: () => {}, addEventListener: () => {} };
global.CustomEvent = class { constructor(type) { this.type = type; } };

const cart = require('../../public/js/services/cart.js');

const TEE = { id: 'tee', slug: 'viking-tee', name: 'Viking Tee', price_isk: 5200, price_eur: 3600, vat_rate: 24, variant_axes: ['color'] };
const WHITE = { id: 'tee-white', sku: 'TEE-WHT', attributes: { color: 'white' }, price_isk: 5600 };
const BOOK = { id: 'book', slug: 'saga', name: 'Saga', price_isk: 3990, price_eur: 2800, vat_rate: 11 };

beforeEach(() => {
  store.clear();
  cart.add(TEE, WHITE, 2);   // 2 × 5.600
  cart.add(BOOK, null, 1);   // 1 × 3.990 at 11 %
});

const lines = () => cart.list().map(l => [l.name, l.priceIsk]);

test('a catalogue price change replaces what the line was added at, and is reported', () => {
  const repriced = cart.syncPrices([
    { ...TEE, variants: [{ ...WHITE, price_isk: 5000 }] },
    { ...BOOK, price_isk: 3490 },
  ]);
  expect(repriced.map(l => l.name)).toEqual(['Viking Tee', 'Saga']);
  expect(lines()).toEqual([['Viking Tee', 5000], ['Saga', 3490]]);
  expect(cart.total('ISK')).toBe(2 * 5000 + 3490);
});

test('an unchanged payload changes nothing and reports nothing', () => {
  expect(cart.syncPrices([{ ...TEE, variants: [WHITE] }, BOOK])).toEqual([]);
  expect(lines()).toEqual([['Viking Tee', 5600], ['Saga', 3990]]);
});

test('a payload without prices never wipes the stored ones', () => {
  const stripped = [{ id: 'tee', name: 'Viking Tee', variants: [{ id: 'tee-white' }] }, { id: 'book', name: 'Saga' }];
  expect(cart.syncPrices(stripped)).toEqual([]);
  expect(lines()).toEqual([['Viking Tee', 5600], ['Saga', 3990]]);
});

test('a product missing from the payload, and an empty payload, are left alone', () => {
  expect(cart.syncPrices([{ ...BOOK, price_isk: 3490 }])).toHaveLength(1);
  expect(lines()).toEqual([['Viking Tee', 5600], ['Saga', 3490]]);
  expect(cart.syncPrices([])).toEqual([]);
  expect(cart.syncPrices(null)).toEqual([]);
});

test('a variant line is not re-priced from the product when its variant is gone', () => {
  expect(cart.syncPrices([{ ...TEE, price_isk: 4500, variants: [] }])).toEqual([]);
  expect(lines()[0]).toEqual(['Viking Tee', 5600]);
});

test('lines carry the product VSK rate; a line stored before rates were kept gets it from the payload', () => {
  expect(cart.list().map(l => l.vatRate)).toEqual([24, 11]);
  // A basket written by the previous release: no vatRate / isService.
  const key = [...store.keys()].find(k => k.startsWith('shop.cart.items::'));
  const legacy = JSON.parse(store.get(key)).map(({ vatRate: _v, isService: _s, ...rest }) => rest);
  store.set(key, JSON.stringify(legacy));
  expect(cart.syncPrices([{ ...TEE, variants: [WHITE] }, { ...BOOK, is_bookable: false }])).toEqual([]);
  expect(cart.list().map(l => [l.vatRate, l.isService])).toEqual([[24, false], [11, false]]);
});

test('vatLines gives the gross per line in the chosen currency, with its rate', () => {
  expect(cart.vatLines('ISK')).toEqual([
    { gross: 2 * 5600, rate: 24, isService: false },
    { gross: 3990, rate: 11, isService: false },
  ]);
  expect(cart.vatLines('EUR')[1]).toEqual({ gross: 2800, rate: 11, isService: false });
});
