// Ported from icelandicstore #430 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26).
'use strict';

/**
 * "Bæta við lit" on the variant grid — the planning and paste halves.
 * Orri (2026-09-25) had four new blank colours to add, each in XS–2XL with the
 * supplier's SKU and barcode: 24+ rows through "+ Add variant" one at a time.
 */
// ESM, compiled to CJS by babel-jest — same trick as tests/unit/colorMatch.test.js.
const { axisValues, planNewValue, parsePaste } = require('../../public/js/utils/variantAddValue.js');

const SIZES = ['2XL', 'L', 'M', 'S', 'XL', 'XS']; // API order is SKU order, not size order
const row = (Color, Size) => ({ id: `${Color}-${Size}`, attributes: { Color, Size } });
const TEE = ['Black (BL)', 'Natural'].flatMap(c => SIZES.map(s => row(c, s)));
const AXES = ['Color', 'Size'];

describe('axisValues', () => {
  test('distinct values in garment order, not SKU order', () => {
    expect(axisValues(TEE, 'Size')).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL']);
  });
  test('reads the axis whatever case the row was written in', () => {
    expect(axisValues([{ attributes: { color: 'Red', size: 'M' } }], 'Color')).toEqual(['Red']);
  });
});

describe('planNewValue', () => {
  test('a new colour crosses every size the product already uses', () => {
    const { rows, error } = planNewValue({ axes: AXES, rows: TEE, axis: 'Color', value: '  Light Heather ' });
    expect(error).toBeNull();
    expect(rows).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL'].map(Size => ({ Color: 'Light Heather', Size })));
  });

  test('a colour that already exists is refused — case and supplier code do not hide it', () => {
    expect(planNewValue({ axes: AXES, rows: TEE, axis: 'Color', value: 'black' }).error).toBe('exists');
    expect(planNewValue({ axes: AXES, rows: TEE, axis: 'Color', value: 'Natural (NL)' }).error).toBe('exists');
  });

  test('a new size crosses every colour', () => {
    const { rows } = planNewValue({ axes: AXES, rows: TEE, axis: 'Size', value: '3XL' });
    expect(rows).toEqual([{ Color: 'Black (BL)', Size: '3XL' }, { Color: 'Natural', Size: '3XL' }]);
  });

  test('nothing typed, an unknown axis, or nothing to cross with plans no rows', () => {
    expect(planNewValue({ axes: AXES, rows: TEE, axis: 'Color', value: ' ' }).error).toBe('empty');
    expect(planNewValue({ axes: AXES, rows: TEE, axis: 'Fit', value: 'Slim' }).error).toBe('empty');
    expect(planNewValue({ axes: AXES, rows: [], axis: 'Color', value: 'Red' }).error).toBe('noOthers');
  });

  test('a single-axis product plans exactly one row', () => {
    const rows = [{ attributes: { Size: 'S' } }];
    expect(planNewValue({ axes: ['Size'], rows, axis: 'Size', value: 'M' }).rows).toEqual([{ Size: 'M' }]);
  });
});

describe('parsePaste', () => {
  const planned = planNewValue({ axes: AXES, rows: TEE, axis: 'Color', value: 'Light Blue' }).rows;
  const paste = (text) => parsePaste(text, planned, AXES, 'Color');
  const six = (fn) => ['XS', 'S', 'M', 'L', 'XL', '2XL'].map(fn).join('\n');

  test('in order: exactly one "SKU TAB barcode" line per row fills every row', () => {
    const r = paste(six((s, i) => `EP01-LB${i}\t505500${i}`).replace(/\n/g, '\r\n'));
    expect(r.errors).toEqual([]);
    expect(r.values[0]).toEqual({ sku: 'EP01-LB0', barcode: '5055000' });
    expect(r.values[5]).toEqual({ sku: 'EP01-LB5', barcode: '5055005' });
  });

  test('in order with a header line: NOTHING is filled — no SKU slides onto the wrong size', () => {
    const r = paste('SKU\tStrikamerki\n' + six((s, i) => `EP01-LB${i}\t5${i}`));
    expect(r.values.every(v => v === null)).toBe(true);
    expect(r.errors).toEqual([{ line: 0, reason: 'count', got: 7 }]);
  });

  test('in order with a row missing: nothing is filled', () => {
    expect(paste('A\nB\nC').values.every(v => v === null)).toBe(true);
  });

  test('space-separated columns are refused, not read as one long SKU', () => {
    const r = paste(six((s, i) => `EP01-LB${i} 505500${i}`));
    expect(r.values.every(v => v === null)).toBe(true);
    expect(r.errors[0]).toEqual({ line: 1, reason: 'spaces' });
  });

  test('keyed: lines that start with the size go to that size, in any order', () => {
    const r = paste('2XL\tEP01-LB5\t55\nxs\tEP01-LB0\t50');
    expect(r.errors).toEqual([]);
    expect(r.values[0]).toEqual({ sku: 'EP01-LB0', barcode: '50' });
    expect(r.values[5]).toEqual({ sku: 'EP01-LB5', barcode: '55' });
    expect(r.values.slice(1, 5).every(v => v === null)).toBe(true); // a partial colour is fine
  });

  test('keyed with a header line: the header is reported and skipped, the rest still land right', () => {
    const r = paste('Stærð\tSKU\tStrikamerki\nS\tEP01-LB1\t51');
    expect(r.errors).toEqual([{ line: 1, reason: 'unknown' }]);
    expect(r.values[1]).toEqual({ sku: 'EP01-LB1', barcode: '51' });
  });

  test('keyed: a size the table lacks is reported, not guessed ("XXL" vs "2XL" is not assumed)', () => {
    const r = paste('S\tA\nXXXL\tB');
    expect(r.errors).toEqual([{ line: 2, reason: 'unknown' }]);
  });

  test('semicolon- or comma-separated hand lists work when there is no tab', () => {
    expect(paste('XS; A1; 111').values[0]).toEqual({ sku: 'A1', barcode: '111' });
    expect(paste('XS, A1, 111').values[0]).toEqual({ sku: 'A1', barcode: '111' });
  });

  test('the same size twice is reported, the first wins', () => {
    const r = paste('S\tA\nS\tB');
    expect(r.values[1]).toEqual({ sku: 'A', barcode: '' });
    expect(r.errors).toEqual([{ line: 2, reason: 'dupe' }]);
  });

  test('in order, a line with three cells whose first is no size is refused (not taken as a SKU)', () => {
    const r = paste(six((s, i) => (i === 0 ? `XXS\tEP01-LB${i}\t1` : `EP01-LB${i}\t1`)));
    expect(r.values.every(v => v === null)).toBe(true);
    expect(r.errors).toEqual([{ line: 1, reason: 'unknown' }]);
  });

  test('blank lines are ignored and empty input fills nothing', () => {
    expect(parsePaste('\nA\n\n', [{ Color: 'X', Size: 'S' }], AXES, 'Color').values[0]).toEqual({ sku: 'A', barcode: '' });
    expect(paste('').values.every(v => v === null)).toBe(true);
  });
});
