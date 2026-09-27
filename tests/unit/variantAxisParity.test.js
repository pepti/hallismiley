// Ported from icelandicstore (the client twin of server/utils/variantAxis.js) (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26).
'use strict';

// Asserts the client mirror (public/js/utils/variantAxis.js) behaves identically
// to the server source of truth (server/utils/variantAxis.js). Both decide what
// "this axis matches that axis" means — the SPA to render a colour swatch, the
// server to resolve a bill-of-materials component down to one variant. Drift
// would let a recipe match on the server while the product page disagrees, or
// worse, decrement a variant the operator never picked.
//
// Compared by BEHAVIOUR over a shared corpus rather than by source text, so a
// harmless reformat does not fail while a real change in outcome does.
// Referenced by both files' header comments.
const server = require('../../server/utils/variantAxis');
const client = require('../../public/js/utils/variantAxis.js');

// Every awkward shape the real catalogue is known to contain, plus the edges.
const AXIS_NAMES = [
  'color', 'Color', 'COLOR', ' color ', 'colour', 'Colour',
  'size', 'Size', 'SIZE', ' size', 'Size ',
  '', null, undefined, 'material', 'Bin Location',
];

const VALUES = [
  'Black', 'black', 'BLACK', ' Black ',
  'Black (BL)', 'Black (BK)', 'Black(BL)', 'Navy (NV)',
  'XL', 'xl', 'X-Large', 'XX Large', 'xx_large', 'XXL',
  '', null, undefined, 'Sage Green', 'sage-green', 'sage_green',
];

describe('variantAxis parity (client ↔ server)', () => {
  test('axisKey agrees on every axis name in the corpus', () => {
    for (const a of AXIS_NAMES) {
      expect(client.axisKey(a)).toBe(server.axisKey(a));
    }
  });

  test('valueKey and colorKey agree on every value in the corpus', () => {
    for (const v of VALUES) {
      expect(client.valueKey(v)).toBe(server.valueKey(v));
      expect(client.colorKey(v)).toBe(server.colorKey(v));
    }
  });

  test('valueKeyFor agrees across the whole axis × value matrix', () => {
    for (const a of AXIS_NAMES) {
      for (const v of VALUES) {
        expect(client.valueKeyFor(a, v)).toBe(server.valueKeyFor(a, v));
      }
    }
  });

  test('readAxis agrees, including when it refuses', () => {
    const rows = [
      { color: 'Navy' },
      { Color: 'Navy' },
      { COLOR: 'Navy', size: 'M' },
      { colour: 'Navy' },              // a different axis — not a match for `color`
      { Color: 'Navy', color: 'Black' }, // ambiguous: must throw on both sides
      {},
      null,
    ];
    for (const row of rows) {
      const s = (() => { try { return { ok: server.readAxis(row, 'color') }; } catch (e) { return { err: e.code }; } })();
      const c = (() => { try { return { ok: client.readAxis(row, 'color') }; } catch (e) { return { err: e.code }; } })();
      expect(c).toEqual(s);
    }
  });
});

// The rules themselves, pinned on the server copy. These are the decisions the
// BOM resolver leans on; if one changes, a build starts moving different stock.
describe('variantAxis rules', () => {
  const { axisKey, valueKey, colorKey, valueKeyFor, readAxis } = server;

  test('axis names fold case and whitespace', () => {
    expect(axisKey(' Color ')).toBe('color');
    expect(axisKey('SIZE')).toBe('size');
  });

  test('colour and color are NOT synonyms — a mis-spelled axis must fail loudly', () => {
    expect(axisKey('colour')).not.toBe(axisKey('color'));
  });

  test('the colour axis sheds a supplier code, other axes do not', () => {
    expect(valueKeyFor('color', 'Black (BL)')).toBe('black');
    expect(valueKeyFor('Color', 'Black (BL)')).toBe('black');
    // Same string on a non-colour axis keeps the parenthetical.
    expect(valueKeyFor('size', 'Large (L)')).not.toBe('large');
  });

  test('two supplier codes for one colour collapse — the resolver must treat that as ambiguous', () => {
    expect(colorKey('Black (BL)')).toBe(colorKey('Black (BK)'));
  });

  test('whitespace and underscores fold, but XL and X-Large stay distinct', () => {
    expect(valueKey('XX Large')).toBe(valueKey('xx_large'));
    expect(valueKey('XL')).not.toBe(valueKey('X-Large'));
  });

  test('readAxis finds an axis whatever case the row was written in', () => {
    expect(readAxis({ Color: 'Navy' }, 'color')).toBe('Navy');
    expect(readAxis({ color: 'Navy' }, 'Color')).toBe('Navy');
    expect(readAxis({ size: 'M' }, 'color')).toBeUndefined();
  });

  test('readAxis refuses a row carrying two keys that differ only by case', () => {
    expect(() => readAxis({ Color: 'Navy', color: 'Black' }, 'color'))
      .toThrow(/ambiguous axis/);
    try { readAxis({ Color: 'Navy', color: 'Black' }, 'color'); } catch (e) {
      expect(e.code).toBe('AXIS_AMBIGUOUS');
      expect(e.keys.sort()).toEqual(['Color', 'color']);
    }
  });
});
