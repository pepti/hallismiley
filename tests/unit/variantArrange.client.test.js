// Ported from icelandicstore #352/#381 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26). Trimmed: the /shop quick-order rows (quickOrderRows.js) are
// ice-only.
'use strict';

/**
 * "Arrange by type" — the display order of a product's variant lines: colour,
 * then size. The API returns SKU order, which only reads right when the SKUs
 * happen to be sequential; the demo grid's `DEMO-RVK-BLK-XS` SKUs sort
 * L, M, S, XL, XS, XXL.
 */
// ESM, compiled to CJS by babel-jest — same trick as tests/unit/colorMatch.test.js.
const {
  arrangeAxes, arrangeVariants, compareAxisValues, sizeRank, colorRank, axisKind,
} = require('../../public/js/utils/variantArrange.js');

const v = (sku, attributes) => ({ id: sku, sku, attributes, active: true });
const label = (x) => Object.values(x.attributes).join('/');

describe('axis order', () => {
  test('colour sorts before size whatever order the product lists them in', () => {
    expect(arrangeAxes(['size', 'color'])).toEqual(['color', 'size']);
    expect(arrangeAxes(['Size', 'Color', 'Fit'])).toEqual(['Color', 'Size', 'Fit']);
  });

  test('Icelandic and British axis names are recognised; others keep their place', () => {
    expect(axisKind('Litur')).toBe('color');
    expect(axisKind('Colour')).toBe('color');
    expect(axisKind('Stærð')).toBe('size');
    expect(axisKind('Scent')).toBe('other');
    expect(arrangeAxes(['Scent', 'Volume'])).toEqual(['Scent', 'Volume']);
  });
});

describe('size ranking', () => {
  test('XS → 2XL, case-blind, with XXL and 2XL the same rank', () => {
    const sizes = ['L', 'm', '2XL', 'XS', 'XL', 's'];
    expect(sizes.sort((a, b) => compareAxisValues('size', a, b))).toEqual(['XS', 's', 'm', 'L', 'XL', '2XL']);
    expect(sizeRank('XXL')).toBe(sizeRank('2XL'));
    expect(sizeRank('3XL')).toBeGreaterThan(sizeRank('2XL'));
  });

  test('unknown sizes go last, in natural (numeric) order', () => {
    const sizes = ['100', 'M', '32', 'One size'];
    expect(sizes.sort((a, b) => compareAxisValues('size', a, b))).toEqual(['M', '32', '100', 'One size']);
  });
});

describe('colour ranking', () => {
  test('a supplier spelling ranks as its known colour', () => {
    expect(colorRank('French Navy (FRNA)')).toBe(colorRank('Navy'));
    expect(colorRank('Black (BL)')).toBe(0);
  });

  test('unknown colours follow the known ones alphabetically', () => {
    const colours = ['Rust', 'White (WH)', 'Burgundy', 'Black (BL)'];
    expect(colours.sort((a, b) => compareAxisValues('Color', a, b)))
      .toEqual(['Black (BL)', 'White (WH)', 'Burgundy', 'Rust']);
  });
});

describe('arrangeVariants', () => {
  // SKU order, as the API returns the demo grid.
  const demo = [
    v('DEMO-RVK-BLK-L',  { Color: 'Black', Size: 'L' }),
    v('DEMO-RVK-BLK-M',  { Color: 'Black', Size: 'M' }),
    v('DEMO-RVK-BLK-S',  { Color: 'Black', Size: 'S' }),
    v('DEMO-RVK-BLK-XL', { Color: 'Black', Size: 'XL' }),
    v('DEMO-RVK-BLK-XS', { Color: 'Black', Size: 'XS' }),
    v('DEMO-RVK-WHT-M',  { Color: 'White', Size: 'M' }),
    v('DEMO-RVK-NVY-S',  { Color: 'Navy', Size: 'S' }),
  ];

  test('the demo grid comes out colour → size', () => {
    expect(arrangeVariants(demo, ['Color', 'Size']).map(label)).toEqual([
      'Black/XS', 'Black/S', 'Black/M', 'Black/L', 'Black/XL', 'Navy/S', 'White/M',
    ]);
  });

  test('does not mutate its input', () => {
    const before = demo.map(x => x.sku);
    arrangeVariants(demo, ['Color', 'Size']);
    expect(demo.map(x => x.sku)).toEqual(before);
  });

  test('attribute keys are read case-blind (admin form lowercases, Shopify does not)', () => {
    const rows = [v('b', { color: 'White', size: 'S' }), v('a', { Color: 'Black', Size: 'M' })];
    expect(arrangeVariants(rows, ['Color', 'Size']).map(x => x.sku)).toEqual(['a', 'b']);
  });

  test('stable: rows equal on every axis keep their arrival order', () => {
    const rows = [v('z', { Size: 'M' }), v('a', { Size: 'M' }), v('k', { Size: 'S' })];
    expect(arrangeVariants(rows, ['Size']).map(x => x.sku)).toEqual(['k', 'z', 'a']);
  });

  test('a row carrying the axis twice orders instead of throwing', () => {
    const rows = [v('a', { Size: 'L', size: 'S' }), v('b', { Size: 'M' })];
    expect(() => arrangeVariants(rows, ['Size'])).not.toThrow();
  });

  test('JSON-string attributes and no axes are tolerated', () => {
    const rows = [v('a', '{"Size":"L"}'), v('b', '{"Size":"S"}')];
    expect(arrangeVariants(rows, ['Size']).map(x => x.sku)).toEqual(['b', 'a']);
    expect(arrangeVariants(rows, []).map(x => x.sku)).toEqual(['a', 'b']);
  });
});

