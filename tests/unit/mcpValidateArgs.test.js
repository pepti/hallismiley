'use strict';

// server/mcp/registry.validateArgs learned arrays and nested objects for
// add_variants (harvest 2 lane 6c, ported from icelandicstore #432), and still
// refuses an unknown key at every level. The flat cases the older tools rely on
// are pinned alongside.
const { validateArgs, getTool } = require('../../server/mcp/registry');

const tool = {
  inputSchema: {
    type: 'object',
    properties: {
      name:  { type: 'string' },
      count: { type: 'integer' },
      mode:  { type: 'string', enum: ['a', 'b'] },
      rows: {
        type: 'array', minItems: 1, maxItems: 3,
        items: {
          type: 'object',
          properties: {
            sku:   { type: 'string' },
            attrs: { type: 'object', additionalProperties: { type: 'string' } },
            price: { type: 'integer' },
          },
          required: ['sku', 'attrs'],
        },
      },
    },
    required: ['rows'],
  },
};
const ok = (args) => expect(validateArgs(tool, args)).toBeNull();
const bad = (args, re) => expect(validateArgs(tool, args)).toMatch(re);

describe('flat arguments (unchanged)', () => {
  test('types, enums and required keys', () => {
    ok({ rows: [{ sku: 'A', attrs: { color: 'Black' } }], name: 'x', count: 2, mode: 'a' });
    bad({ rows: [{ sku: 'A', attrs: {} }], count: 1.5 }, /count must be an integer/);
    bad({ rows: [{ sku: 'A', attrs: {} }], mode: 'c' }, /mode must be one of a, b/);
    bad({}, /missing required argument: rows/);
    bad({ rows: [{ sku: 'A', attrs: {} }], extra: 1 }, /unknown argument: extra/);
    bad([], /arguments must be an object/);
  });

  test('an inherited key name is not waved through', () => {
    bad({ rows: [{ sku: 'A', attrs: {} }], constructor: 'x' }, /unknown argument: constructor/);
  });
});

describe('arrays', () => {
  test('must be arrays, within minItems / maxItems', () => {
    bad({ rows: 'A' }, /rows must be an array/);
    bad({ rows: [] }, /rows needs at least 1 item/);
    bad({ rows: [1, 2, 3, 4].map(i => ({ sku: String(i), attrs: {} })) }, /rows may hold at most 3 items/);
  });

  test('each item is checked, and the error names its index', () => {
    bad({ rows: [{ sku: 'A', attrs: {} }, 'B'] }, /rows\[1\] must be an object/);
    bad({ rows: [{ sku: 'A', attrs: {} }, { attrs: {} }] }, /missing required argument: rows\[1\]\.sku/);
    bad({ rows: [{ sku: 'A', attrs: {}, price: '9' }] }, /rows\[0\]\.price must be an integer/);
  });
});

describe('nested objects', () => {
  test('unknown keys are refused inside an item', () => {
    bad({ rows: [{ sku: 'A', attrs: {}, stock: 5 }] }, /unknown argument: rows\[0\]\.stock/);
  });

  test('additionalProperties types the free-form keys', () => {
    ok({ rows: [{ sku: 'A', attrs: { Color: 'Black', Size: 'M' } }] });
    bad({ rows: [{ sku: 'A', attrs: { Size: 3 } }] }, /rows\[0\]\.attrs\.Size must be a string/);
    bad({ rows: [{ sku: 'A', attrs: ['Black'] }] }, /rows\[0\]\.attrs must be an object/);
  });
});

describe('the real add_variants schema', () => {
  test('accepts a colour in two sizes and refuses a stock figure', () => {
    const add = getTool('add_variants');
    expect(add).toBeTruthy();
    const rows = [
      { attributes: { color: 'Light Blue', size: 'S' }, sku: 'LB-S', barcode: '5055000000011' },
      { attributes: { color: 'Light Blue', size: 'M' }, sku: 'LB-M', price_isk: 3990 },
    ];
    expect(validateArgs(add, { slug: 'tee', variants: rows })).toBeNull();
    expect(validateArgs(add, { slug: 'tee', variants: [{ ...rows[0], stock: 4 }] })).toMatch(/unknown argument: variants\[0\]\.stock/);
    expect(validateArgs(add, { slug: 'tee', variants: [] })).toMatch(/at least 1/);
  });
});
