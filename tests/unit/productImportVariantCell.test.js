'use strict';

// The "Variant" cell — "Color: Black, Size: M" — has one formatter and one
// parser (productImport/variantCell). The export writes it, the import reads
// it, and the variant-creating import groups on it, so the two directions must
// agree byte for byte and the parser must refuse anything it cannot round-trip.
const { formatVariantCell, parseVariantCell, MAX_AXES } = require('../../server/services/productImport/variantCell');

describe('formatVariantCell', () => {
  test('keys come out in variant_axes order, not jsonb order', () => {
    // jsonb hands the keys back sorted (Color before Size); the product's axes
    // say size first.
    expect(formatVariantCell({ Color: 'Black', Size: 'M' }, ['size', 'color'])).toBe('Size: M, Color: Black');
    expect(formatVariantCell({ Color: 'Black', Size: 'M' }, ['color', 'size'])).toBe('Color: Black, Size: M');
  });

  test('axis matching is case-insensitive; keys the axes do not name follow in stored order', () => {
    expect(formatVariantCell({ Size: 'M', Colour: 'Red', Material: 'Wool' }, ['COLOUR'])).toBe('Colour: Red, Size: M, Material: Wool');
  });

  test('no axes → stored order; nothing → empty string', () => {
    expect(formatVariantCell({ b: '2', a: '1' })).toBe('b: 2, a: 1');
    expect(formatVariantCell(null)).toBe('');
    expect(formatVariantCell('nope')).toBe('');
  });
});

describe('parseVariantCell', () => {
  test('round-trips what the export writes, values with commas and slashes included', () => {
    const attrs = { Color: 'Black, matte', Size: 'S/M' };
    const cell = formatVariantCell(attrs, ['color', 'size']);
    expect(cell).toBe('Color: Black, matte, Size: S/M');
    expect(parseVariantCell(cell)).toEqual({ ok: true, attributes: attrs });
  });

  test('tolerates spacing and keeps the first colon as the separator', () => {
    expect(parseVariantCell('Size:M,Color:  Black ')).toEqual({ ok: true, attributes: { Size: 'M', Color: 'Black' } });
    expect(parseVariantCell('Time: 10:30')).toEqual({ ok: true, attributes: { Time: '10:30' } });
  });

  test('refuses a part with no colon, an empty key or value, and an empty cell', () => {
    expect(parseVariantCell('Size M').ok).toBe(false);
    expect(parseVariantCell(': M').ok).toBe(false);
    expect(parseVariantCell('Size:').ok).toBe(false);
    expect(parseVariantCell('').ok).toBe(false);
    expect(parseVariantCell(undefined).ok).toBe(false);
  });

  test('a trailing word with no colon is part of the previous VALUE, by the same rule that keeps "Black, matte" whole', () => {
    // The format cannot tell "a value containing a comma" from "an axis that
    // lost its value"; the export never writes the latter, and the split rule
    // is only ever "before Key:". So this is a value, not a refusal.
    expect(parseVariantCell('Size: M, Colour')).toEqual({ ok: true, attributes: { Size: 'M, Colour' } });
  });

  test('refuses two keys that are the same axis under axisKey', () => {
    const r = parseVariantCell('Size: M, size: L');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('variant_invalid');
    expect(r.detail).toMatch(/repeated/);
  });

  test('refuses more than MAX_AXES axes and over-long keys or values', () => {
    const many = Array.from({ length: MAX_AXES + 1 }, (_, i) => `A${i}: v`).join(', ');
    expect(parseVariantCell(many).ok).toBe(false);
    expect(parseVariantCell(`${'k'.repeat(51)}: v`).ok).toBe(false);
    expect(parseVariantCell(`Size: ${'x'.repeat(101)}`).ok).toBe(false);
  });

  test('a cell the formatter wrote always parses back', () => {
    for (const attrs of [
      { Size: 'XL' },
      { Color: 'Navy (FRNA)', Size: 'XS' },
      { Litur: 'Rauður', Stærð: '38-40', Efni: 'Ull' },
    ]) {
      expect(parseVariantCell(formatVariantCell(attrs, Object.keys(attrs)))).toEqual({ ok: true, attributes: attrs });
    }
  });
});
