'use strict';

/**
 * public/js/utils/availability.js — the basket-side availability gate
 * (harvested from icelandicstore #244; ENHANCEMENTS #25). The cart and the
 * checkout share these so a sold-out line (or a basket line that went stale)
 * is caught before the customer is sent to Stripe. Pure module, compiled from
 * ESM by babel-jest.
 */
const {
  MAX_QTY_PER_ITEM, lineKey, availabilityOf, capFor, cappedQty, indexAvailability, shortfallOf,
} = require('../../public/js/utils/availability.js');

const plain   = { id: 'p1', name: 'Mug', available: 4, variant_axes: [] };
const service = { id: 'p2', name: 'Consultation', available: 0, is_bookable: true, variant_axes: [] };
const varProd = {
  id: 'p3', name: 'Hat', available: 5, variant_axes: ['size'],
  variants: [
    { id: 'v1', available: 5, active: true },
    { id: 'v2', available: 0, active: true },
    { id: 'v3', available: 9, active: false },
  ],
};

describe('availabilityOf / capFor / cappedQty', () => {
  test('reads the variant number when a variant is given, else the product', () => {
    expect(availabilityOf(varProd, varProd.variants[1])).toEqual({ available: 0, unlimited: false });
    expect(availabilityOf(plain)).toEqual({ available: 4, unlimited: false });
  });
  test('a bookable service at product level is not stock-limited', () => {
    expect(capFor(availabilityOf(service))).toBe(MAX_QTY_PER_ITEM);
  });
  test('cap = available, never negative, never above the server maximum', () => {
    expect(capFor({ available: 4, unlimited: false })).toBe(4);
    expect(capFor({ available: -2, unlimited: false })).toBe(0);
    expect(capFor({ available: 999, unlimited: false })).toBe(MAX_QTY_PER_ITEM);
  });
  test('missing availability reads as 0 (sold out) rather than unlimited', () => {
    expect(availabilityOf({ id: 'x' })).toEqual({ available: 0, unlimited: false });
  });
  test('cappedQty clamps to the cap', () => {
    expect(cappedQty(3, 4)).toBe(3);
    expect(cappedQty(10, 4)).toBe(4);
    expect(cappedQty(2, 0)).toBe(0);
  });
});

describe('indexAvailability + shortfallOf', () => {
  const index = indexAvailability([plain, service, varProd]);
  test('indexes single-SKU products by product and variant products per active variant', () => {
    expect(index.get(lineKey('p1', null))).toMatchObject({ available: 4, name: 'Mug' });
    expect(index.get(lineKey('p3', 'v1'))).toMatchObject({ available: 5, name: 'Hat' });
    expect(index.has(lineKey('p3', 'v3'))).toBe(false);   // inactive variant
    expect(index.has(lineKey('p3', null))).toBe(false);   // variant products have no product-level line
  });
  test('a line within availability is fine', () => {
    expect(shortfallOf({ productId: 'p1', variantId: null, qty: 4 }, index)).toBeNull();
  });
  test('a line over availability reports what is left; sold out is flagged as `out`', () => {
    expect(shortfallOf({ productId: 'p1', variantId: null, qty: 5 }, index)).toEqual({ available: 4, out: false });
    expect(shortfallOf({ productId: 'p3', variantId: 'v2', qty: 1 }, index)).toEqual({ available: 0, out: true });
  });
  test('services and unknown SKUs are never flagged here', () => {
    expect(shortfallOf({ productId: 'p2', variantId: null, qty: 3 }, index)).toBeNull();
    expect(shortfallOf({ productId: 'gone', variantId: null, qty: 1 }, index)).toBeNull();
  });
});
