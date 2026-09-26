// Ported from icelandicstore #334/#335 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26). Trimmed: the browser mirror of nameCarriesLabel.
// Variant label for a printed/shown order line — "White / M". Orri,
// 2026-09-16: an email-imported order's delivery note printed four identical
// "T-Shirt | Cats of Reykjavik" lines because staff paths store no size.
const { variantLabel, lineAttributes, lineVariantLabel, nameCarriesLabel } = require('../../server/utils/variantLabel');
// ESM, compiled to CJS by babel-jest — same trick as tests/unit/colorMatch.test.js.

describe('variantLabel', () => {
  test('joins values in axis order', () => {
    expect(variantLabel({ Size: 'M', Color: 'White' }, ['Color', 'Size'])).toBe('White / M');
  });

  test('matches axis names case-insensitively (importer "Size" vs form "size")', () => {
    expect(variantLabel({ size: 'XL' }, ['Size'])).toBe('XL');
    expect(variantLabel({ Color: 'navy', SIZE: 's' }, ['color', 'size'])).toBe('Navy / S');
  });

  test('Icelandic axis names work', () => {
    expect(variantLabel({ 'stærð': 'L' }, ['stærð'])).toBe('L');
  });

  test('empty axes fall back to the attributes object order', () => {
    expect(variantLabel({ Color: 'Black', Size: 'S' }, [])).toBe('Black / S');
    expect(variantLabel({ Color: 'Black', Size: 'S' }, null)).toBe('Black / S');
  });

  test('skips blank values and missing axes', () => {
    expect(variantLabel({ Color: '', Size: 'M' }, ['Color', 'Size'])).toBe('M');
    expect(variantLabel({ Size: 'M' }, ['Color', 'Size'])).toBe('M');
  });

  test('an axis written twice differing only by case is skipped, not guessed', () => {
    expect(variantLabel({ Color: 'Navy', color: 'Black', Size: 'M' }, ['Color', 'Size'])).toBe('M');
  });

  test('axes that name none of the attribute keys fall back to every value', () => {
    // The writers disagree: an "stærð" product whose variants were stored as {"Size": ...}.
    expect(variantLabel({ Size: 'M' }, ['stærð'])).toBe('M');
    expect(variantLabel({ Color: 'Navy', Size: 'S' }, ['Colour'])).toBe('Navy / S');
  });

  test('null when there is nothing to show', () => {
    expect(variantLabel(null, ['Size'])).toBeNull();
    expect(variantLabel({}, ['Size'])).toBeNull();
    expect(variantLabel('M', ['Size'])).toBeNull();
  });
});

describe('lineVariantLabel', () => {
  test('uses the live variant attributes when the line has no snapshot', () => {
    expect(lineVariantLabel({
      product_name_snapshot: 'T-Shirt | Cats of Reykjavik',
      variant_attributes: null,
      variant_attributes_current: { Color: 'White', Size: 'M' },
      variant_axes: ['Color', 'Size'],
    })).toBe('White / M');
  });

  test('the snapshot wins over the live attributes', () => {
    expect(lineVariantLabel({
      product_name_snapshot: 'Hoodie',
      variant_attributes: { Size: 'L' },
      variant_attributes_current: { Size: 'XL' },
      variant_axes: ['Size'],
    })).toBe('L');
  });

  test('an empty {} snapshot does not hide the live attributes', () => {
    const item = {
      product_name_snapshot: 'T-Shirt',
      variant_attributes: {},
      variant_attributes_current: { Size: 'L' },
      variant_axes: ['Size'],
    };
    expect(lineAttributes(item)).toEqual({ Size: 'L' });
    expect(lineVariantLabel(item)).toBe('L');
  });

  test('null when the name already carries the label (checkout lines)', () => {
    expect(lineVariantLabel({
      product_name_snapshot: 'Smiley T-shirt — Black / M',
      variant_attributes: { Color: 'black', Size: 'M' },
      variant_axes: ['Color', 'Size'],
    })).toBeNull();
  });

  test('null for a Shopify-imported line whose name ends " - <size>" (TEST run of #334)', () => {
    // #1272 line 156 on TEST printed "XS" in bold under a name already ending "- XS".
    expect(lineVariantLabel({
      product_name_snapshot: 'Hoodie | Cats of Reykjavik | Forest Green (FGR) - XS',
      variant_attributes: null,
      variant_attributes_current: { Size: 'XS' },
      variant_axes: ['Size'],
    })).toBeNull();
  });

  test('null for a simple product line', () => {
    expect(lineVariantLabel({ product_name_snapshot: 'Postcard', variant_attributes: null, variant_attributes_current: null, variant_axes: [] })).toBeNull();
    expect(lineVariantLabel(null)).toBeNull();
  });
});

// [name, label, carries?] — the server copy (the engine carries no browser mirror).
const CARRIES_CASES = [
  // checkout (buildLineName)
  ['Smiley T-shirt — Black / M', 'Black / M', true],
  ['T-Shirt — White (WH) / S', 'White (WH) / S', true],
  // Shopify-imported "#NNNN" orders
  ['Hoodie | Cats of Reykjavik | Forest Green (FGR) - XS', 'XS', true],
  ['T-Shirt - I Puffin Love You - S / Blush Pink', 'S / Blush Pink', true],
  // same parts, other order and case
  ['T-Shirt - I Puffin Love You - S / Blush Pink', 'Blush Pink / S', true],
  ['Tee — black / m', 'Black / M', true],
  // en dash
  ['Tee – XL', 'XL', true],
  // the name carries every label part plus more — nothing left to add
  ['Tee - Sweet Pink (SL) / XS', 'XS', true],
  // a hyphen inside the product name is not a variant suffix
  ['T-Shirt - I Puffin Love You', 'S / Blush Pink', false],
  ['T-Shirt | Cats of Reykjavik', 'White / M', false],
  // the label adds information the name does not have
  ['T-Shirt | Cats of Reykjavik - XS', 'Sweet Pink (SL) / XS', false],
  // no separator: "XS" at the end of a word is not a size suffix
  ['Hoodie XS', 'XS', false],
  ['T-Shirt-XS', 'XS', false],
  // nothing to compare
  ['Tee - M', '', false],
  ['', 'M', false],
  [null, 'M', false],
];

describe.each([
  ['server', nameCarriesLabel],
])('nameCarriesLabel (%s)', (_which, fn) => {
  test.each(CARRIES_CASES)('%p carries %p → %p', (name, label, expected) => {
    expect(fn(name, label)).toBe(expected);
  });
});
