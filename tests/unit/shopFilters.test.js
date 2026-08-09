'use strict';

/**
 * Unit tests for the pure helpers exported by
 * public/js/components/ShopFilters.js — the section-aware filter logic
 * added in shop-redesign step 3.
 *
 * ShopFilters is a browser ESM that imports cart.js (uses localStorage /
 * window) and i18n.js (reads window.__locale), so we mock both before
 * the require() so the module load doesn't blow up under Jest's Node env.
 * applyFilters / parseStateFromQs / stateToQs are pure and don't actually
 * touch either of those at runtime.
 */

jest.mock('../../public/js/services/cart.js', () => ({
  subscribe:   () => () => {},
  getCurrency: () => 'ISK',
}), { virtual: false });

jest.mock('../../public/js/i18n/i18n.js', () => ({
  t: (k) => k,
}), { virtual: false });

const {
  applyFilters,
  parseStateFromQs,
  stateToQs,
} = require('../../public/js/components/ShopFilters');

// Helpers — minimal product fixtures keyed on whichever fields a given
// test cares about. ISK prices are whole krónur; the filter compares
// against the requested currency's stored minor-unit value.
function makeProduct(over = {}) {
  return {
    id: `p-${Math.random().toString(36).slice(2, 8)}`,
    name: over.name || 'Product',
    description: '',
    price_isk: 1000,
    price_eur: 700,
    stock: 1,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    category: 'product',
    subcategory: null,
    duration_minutes: null,
    delivery_format: null,
    is_bookable: false,
    shape: null,
    capacity_litres: null,
    ...over,
  };
}

// State that mirrors DEFAULT_STATE so each test starts from a known shape.
function defaultState(over = {}) {
  return {
    q: '',
    shapes: [],
    capacities: [],
    durations: [],
    formats: [],
    subcategories: [],
    priceMin: '',
    priceMax: '',
    inStockOnly: false,
    sort: 'featured',
    ...over,
  };
}

describe('ShopFilters — applyFilters with service axes', () => {
  describe('durations', () => {
    const products = [
      makeProduct({ id: 'p-30',  duration_minutes: 30,  name: '30-min' }),   // bucket 1h
      makeProduct({ id: 'p-90',  duration_minutes: 90,  name: '90-min' }),   // bucket 1h boundary
      makeProduct({ id: 'p-180', duration_minutes: 180, name: '3-hour' }),   // bucket half-day
      makeProduct({ id: 'p-300', duration_minutes: 300, name: '5-hour' }),   // bucket half-day boundary
      makeProduct({ id: 'p-480', duration_minutes: 480, name: '8-hour' }),   // bucket full-day
      makeProduct({ id: 'p-null', duration_minutes: null, name: 'no-duration' }),
    ];

    test('"1h" returns only rows with duration_minutes in [1, 90]', () => {
      const out = applyFilters(products, defaultState({ durations: ['1h'] }), 'ISK');
      expect(out.map(p => p.id).sort()).toEqual(['p-30', 'p-90'].sort());
    });

    test('"half-day" covers 91..300 inclusive', () => {
      const out = applyFilters(products, defaultState({ durations: ['half-day'] }), 'ISK');
      expect(out.map(p => p.id).sort()).toEqual(['p-180', 'p-300'].sort());
    });

    test('"full-day" covers 301+', () => {
      const out = applyFilters(products, defaultState({ durations: ['full-day'] }), 'ISK');
      expect(out.map(p => p.id)).toEqual(['p-480']);
    });

    test('multi-select unions ranges', () => {
      const out = applyFilters(products, defaultState({ durations: ['1h', 'full-day'] }), 'ISK');
      expect(out.map(p => p.id).sort()).toEqual(['p-30', 'p-480', 'p-90'].sort());
    });

    test('null duration_minutes never matches any bucket', () => {
      const out = applyFilters(products, defaultState({ durations: ['1h', 'half-day', 'full-day'] }), 'ISK');
      expect(out.find(p => p.id === 'p-null')).toBeUndefined();
    });

    test('empty selection is a no-op (returns all rows)', () => {
      const out = applyFilters(products, defaultState({ durations: [] }), 'ISK');
      expect(out).toHaveLength(products.length);
    });
  });

  describe('formats', () => {
    const products = [
      makeProduct({ id: 'remote',    delivery_format: 'remote' }),
      makeProduct({ id: 'inperson',  delivery_format: 'in_person' }),
      makeProduct({ id: 'hybrid',    delivery_format: 'hybrid' }),
      makeProduct({ id: 'null',      delivery_format: null }),
    ];

    test('single-format filter returns only matching rows', () => {
      const out = applyFilters(products, defaultState({ formats: ['remote'] }), 'ISK');
      expect(out.map(p => p.id)).toEqual(['remote']);
    });

    test('multi-format filter unions the choices', () => {
      const out = applyFilters(products, defaultState({ formats: ['remote', 'hybrid'] }), 'ISK');
      expect(out.map(p => p.id).sort()).toEqual(['hybrid', 'remote'].sort());
    });

    test('null delivery_format never matches', () => {
      const out = applyFilters(products, defaultState({ formats: ['remote', 'in_person', 'hybrid'] }), 'ISK');
      expect(out.find(p => p.id === 'null')).toBeUndefined();
    });
  });

  describe('subcategories', () => {
    const products = [
      makeProduct({ id: 'apparel-a',  subcategory: 'apparel' }),
      makeProduct({ id: 'apparel-b',  subcategory: 'apparel' }),
      makeProduct({ id: 'tv-wall',    subcategory: 'tv-wall' }),
      makeProduct({ id: 'no-sub',     subcategory: null }),
    ];

    test('returns only rows with matching subcategory', () => {
      const out = applyFilters(products, defaultState({ subcategories: ['apparel'] }), 'ISK');
      expect(out.map(p => p.id).sort()).toEqual(['apparel-a', 'apparel-b']);
    });

    test('null subcategory never matches', () => {
      const out = applyFilters(products, defaultState({ subcategories: ['apparel', 'tv-wall'] }), 'ISK');
      expect(out.find(p => p.id === 'no-sub')).toBeUndefined();
    });
  });

  describe('axis combinations', () => {
    test('duration AND format are intersected, not unioned', () => {
      const products = [
        makeProduct({ id: 'remote-1h',    duration_minutes: 60,  delivery_format: 'remote' }),
        makeProduct({ id: 'remote-full',  duration_minutes: 480, delivery_format: 'remote' }),
        makeProduct({ id: 'inperson-1h',  duration_minutes: 60,  delivery_format: 'in_person' }),
      ];
      const out = applyFilters(
        products,
        defaultState({ durations: ['1h'], formats: ['remote'] }),
        'ISK',
      );
      expect(out.map(p => p.id)).toEqual(['remote-1h']);
    });
  });
});

describe('ShopFilters — URL serialization round-trip', () => {
  test('round-trips every service-axis state field', () => {
    const original = defaultState({
      q: 'hello',
      durations: ['1h', 'half-day'],
      formats: ['remote', 'hybrid'],
      subcategories: ['apparel', 'tv-wall'],
      sort: 'price-asc',
    });
    const qs = stateToQs(original);
    const parsed = parseStateFromQs(qs);

    expect(parsed.q).toBe('hello');
    expect(parsed.durations.sort()).toEqual(['1h', 'half-day'].sort());
    expect(parsed.formats.sort()).toEqual(['hybrid', 'remote'].sort());
    expect(parsed.subcategories.sort()).toEqual(['apparel', 'tv-wall'].sort());
    expect(parsed.sort).toBe('price-asc');
  });

  test('empty arrays produce no querystring keys for service axes', () => {
    const qs = stateToQs(defaultState({}));
    expect(qs).not.toMatch(/dur=|fmt=|sub=/);
  });

  test('parseStateFromQs ignores unknown keys', () => {
    const parsed = parseStateFromQs('hello=world&dur=1h');
    expect(parsed.durations).toEqual(['1h']);
    // Not an exhaustive shape test — just that the parser doesn't choke.
    expect(parsed).toEqual(expect.objectContaining({
      formats: expect.any(Array),
      subcategories: expect.any(Array),
    }));
  });
});
