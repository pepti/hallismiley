// Ported from icelandicstore #381 (ice@941cf51d; harvest 2 lane 6c,
// 2026-09-26).
'use strict';

/**
 * Clickable column-header sorting on a list of variant lines.
 *
 * Owner request 2026-09-20: click colour, size and Fjöldi to arrange the lines,
 * instead of the single "Arrange by type" button PR #352 shipped. The value
 * ORDER (XS → 2XL, "French Navy (FRNA)" ranks as navy) is pinned by
 * variantArrange.test.js; this file covers the header mechanics on top of it —
 * the click cycle, the multi-column comparator, and the remembered state.
 */
// ESM, compiled to CJS by babel-jest — same trick as tests/unit/colorMatch.test.js.
const {
  nextSortCols, variantComparator, readSortCols, writeSortCols, AXIS_FIELD, VARIANT_FIELD,
} = require('../../public/js/utils/variantSort.js');

const COLOR = AXIS_FIELD('color');
const SIZE = AXIS_FIELD('size');

const v = (sku, attributes, stock) => ({ id: sku, sku, attributes, stock });
const skus = (rows, cmp) => rows.slice().sort(cmp).map(r => r.sku);

describe('the click cycle', () => {
  test('absent → ascending → descending → gone', () => {
    let cols = nextSortCols([], COLOR);
    expect(cols).toEqual([{ field: COLOR, dir: 'asc' }]);
    cols = nextSortCols(cols, COLOR);
    expect(cols).toEqual([{ field: COLOR, dir: 'desc' }]);
    cols = nextSortCols(cols, COLOR);
    expect(cols).toEqual([]);
  });

  test('a second column is appended, and keeps its place when reversed', () => {
    const cols = nextSortCols(nextSortCols([], COLOR), SIZE);
    expect(cols.map(c => c.field)).toEqual([COLOR, SIZE]);
    // Clicking size again reverses SIZE only — colour stays the first key.
    const next = nextSortCols(cols, SIZE);
    expect(next).toEqual([{ field: COLOR, dir: 'asc' }, { field: SIZE, dir: 'desc' }]);
    // Colour is still ascending, so clicking it reverses rather than drops it —
    // and it keeps its place at the front.
    const reversed = nextSortCols(next, COLOR);
    expect(reversed).toEqual([{ field: COLOR, dir: 'desc' }, { field: SIZE, dir: 'desc' }]);
    // A third click drops colour and leaves size where it was.
    expect(nextSortCols(reversed, COLOR)).toEqual([{ field: SIZE, dir: 'desc' }]);
  });

  test('a missing or junk current value is treated as no sort', () => {
    expect(nextSortCols(undefined, SIZE)).toEqual([{ field: SIZE, dir: 'asc' }]);
    expect(nextSortCols(null, SIZE)).toEqual([{ field: SIZE, dir: 'asc' }]);
  });
});

describe('variantComparator', () => {
  // The demo grid's SKUs sort L, M, S, XL, XS — the case the feature exists for.
  const rows = [
    v('DEMO-BLK-L', { Color: 'Black', Size: 'L' }, 4),
    v('DEMO-BLK-S', { Color: 'Black', Size: 'S' }, 11),
    v('DEMO-WHT-M', { Color: 'White', Size: 'M' }, 0),
    v('DEMO-NVY-XS', { Color: 'French Navy (FRNA)', Size: 'XS' }, 9),
  ];
  const axes = ['Color', 'Size'];

  test('colour then size, the way the owner described it', () => {
    const cmp = variantComparator([{ field: COLOR, dir: 'asc' }, { field: SIZE, dir: 'asc' }], { axes });
    expect(skus(rows, cmp)).toEqual(['DEMO-BLK-S', 'DEMO-BLK-L', 'DEMO-NVY-XS', 'DEMO-WHT-M']);
  });

  test('reversing the second column leaves the first alone', () => {
    const cmp = variantComparator([{ field: COLOR, dir: 'asc' }, { field: SIZE, dir: 'desc' }], { axes });
    expect(skus(rows, cmp)).toEqual(['DEMO-BLK-L', 'DEMO-BLK-S', 'DEMO-NVY-XS', 'DEMO-WHT-M']);
  });

  test('attribute keys are read case-blind (the admin form lowercases, Shopify does not)', () => {
    const mixed = [v('b', { color: 'White', size: 'S' }), v('a', { Color: 'Black', Size: 'M' })];
    const cmp = variantComparator([{ field: COLOR, dir: 'asc' }], { axes });
    expect(skus(mixed, cmp)).toEqual(['a', 'b']);
  });

  test('quantity sorts numerically, and a blank figure is unknown — it goes last', () => {
    const qty = [v('a', {}, 9), v('b', {}, 10), v('c', {}, null), v('d', {}, 2)];
    expect(skus(qty, variantComparator([{ field: 'stock', dir: 'asc' }]))).toEqual(['d', 'a', 'b', 'c']);
    // Descending puts the unknown first rather than pretending it is zero.
    expect(skus(qty, variantComparator([{ field: 'stock', dir: 'desc' }]))).toEqual(['c', 'b', 'a', 'd']);
  });

  test('a negative on-hand sorts below zero, not as text', () => {
    const qty = [v('a', {}, 3), v('b', {}, -2), v('c', {}, 0)];
    expect(skus(qty, variantComparator([{ field: 'stock', dir: 'asc' }]))).toEqual(['b', 'c', 'a']);
  });

  test('SKU sorts naturally: 9 before 10, case-blind', () => {
    const list = [v('ICE-10', {}), v('ICE-9', {}), v('ice-2', {})];
    expect(skus(list, variantComparator([{ field: 'sku', dir: 'asc' }]))).toEqual(['ice-2', 'ICE-9', 'ICE-10']);
  });

  test('the quick view\'s single column sorts on every axis at once', () => {
    const cmp = variantComparator([{ field: VARIANT_FIELD, dir: 'asc' }], { axes });
    expect(skus(rows, cmp)).toEqual(['DEMO-BLK-S', 'DEMO-BLK-L', 'DEMO-NVY-XS', 'DEMO-WHT-M']);
  });

  test('an axis nobody ranks falls back to natural order', () => {
    const scents = [v('c', { Scent: 'Vanilla' }), v('a', { Scent: 'Birch' }), v('b', { Scent: 'moss' })];
    const cmp = variantComparator([{ field: AXIS_FIELD('Scent'), dir: 'asc' }], { axes: ['Scent'] });
    expect(skus(scents, cmp)).toEqual(['a', 'b', 'c']);
  });

  test('no columns clicked → everything is equal, so the API order survives', () => {
    expect(skus(rows, variantComparator([]))).toEqual(rows.map(r => r.sku));
  });

  test('a caller with its own row shape supplies read() (the new-product preview)', () => {
    const combos = [
      { attrs: { size: 'M' }, row: { stock: '2' } },
      { attrs: { size: 'S' }, row: { stock: '7' } },
    ];
    const read = (m, field) => (field.startsWith('attr:') ? m.attrs[field.slice(5)] : m.row[field]);
    const bySize = variantComparator([{ field: SIZE, dir: 'asc' }], { read });
    expect(combos.slice().sort(bySize).map(m => m.attrs.size)).toEqual(['S', 'M']);
    const byQty = variantComparator([{ field: 'stock', dir: 'asc' }], { read });
    expect(combos.slice().sort(byQty).map(m => m.attrs.size)).toEqual(['M', 'S']);
  });
});

describe('the remembered arrangement', () => {
  // testEnvironment is 'node', so the browser globals the module reads are
  // stubbed here — same pattern as cartGuestMerge.client.test.js.
  const KEY = 'variantSort.test';
  let store;
  beforeAll(() => {
    global.window = {
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, val) => { store[k] = String(val); },
        removeItem: (k) => { delete store[k]; },
      },
    };
  });
  afterAll(() => { delete global.window; });
  beforeEach(() => { store = {}; });

  test('round-trips, and clearing removes the entry entirely', () => {
    writeSortCols(KEY, [{ field: COLOR, dir: 'asc' }, { field: SIZE, dir: 'desc' }]);
    expect(readSortCols(KEY)).toEqual([{ field: COLOR, dir: 'asc' }, { field: SIZE, dir: 'desc' }]);
    writeSortCols(KEY, []);
    expect(KEY in store).toBe(false);
    expect(readSortCols(KEY)).toEqual([]);
  });

  test('a stored value that is junk, half-written or from an older shape reads as no sort', () => {
    store[KEY] = 'not json';
    expect(readSortCols(KEY)).toEqual([]);
    store[KEY] = '"1"';                       // the #352 toggle's value
    expect(readSortCols(KEY)).toEqual([]);
    store[KEY] = '[{"field":"sku"},{"dir":"asc"},{"field":"bin","dir":"up"}]';
    expect(readSortCols(KEY)).toEqual([]);
  });

  test('only the two fields it understands survive a read', () => {
    store[KEY] = '[{"field":"sku","dir":"asc","extra":1}]';
    expect(readSortCols(KEY)).toEqual([{ field: 'sku', dir: 'asc' }]);
  });
});

describe('the header cell', () => {
  // The markup contract the e2e drives, and the a11y shape the review asked
  // for: the CELL stays a columnheader carrying aria-sort, and the control
  // inside it is a real button (so Enter and Space need no handler of ours).
  const { sortThHtml } = require('../../public/js/utils/variantSort.js');

  test('unsorted: a columnheader with aria-sort="none" and no arrow', () => {
    const html = sortThHtml({ field: 'stock', label: 'Fjöldi', cols: [] });
    expect(html).toContain('<th class="vsort-th" scope="col" aria-sort="none">');
    expect(html).toContain('<button type="button" class="vsort-th__btn" data-sortcol="stock"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('vsort-th__arrow');
  });

  test('sorted: aria-sort follows the direction, and the arrow carries it visually', () => {
    const asc = sortThHtml({ field: COLOR, label: 'Litur', cols: [{ field: COLOR, dir: 'asc' }] });
    expect(asc).toContain('aria-sort="ascending"');
    expect(asc).toContain('▲');
    const desc = sortThHtml({ field: COLOR, label: 'Litur', cols: [{ field: COLOR, dir: 'desc' }] });
    expect(desc).toContain('aria-sort="descending"');
    expect(desc).toContain('▼');
  });

  test('the precedence badge appears only once a second column is active', () => {
    const alone = sortThHtml({ field: COLOR, label: 'Litur', cols: [{ field: COLOR, dir: 'asc' }] });
    expect(alone).not.toContain('vsort-th__order');
    const pair = sortThHtml({
      field: SIZE, label: 'Stærð',
      cols: [{ field: COLOR, dir: 'asc' }, { field: SIZE, dir: 'asc' }],
    });
    expect(pair).toContain('<span class="vsort-th__order" aria-hidden="true">2</span>');
  });

  test('a label is escaped, so a product axis cannot inject markup', () => {
    const html = sortThHtml({ field: AXIS_FIELD('a"><b>'), label: '<b>x</b>', cols: [] });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('data-sortcol="attr:a&quot;&gt;&lt;b&gt;"');
  });
});

describe('filterSortCols — a remembered column the table does not have', () => {
  const { filterSortCols } = require('../../public/js/utils/variantSort.js');

  // The trap: one remembered list serves every product, but axis columns do
  // not. Sort a colour+size product by colour, open a size-only one, and that
  // colour key would order rows from a column with no header to show it —
  // numbering the visible column "2" with no "1", and unclearable from there.
  test('keeps what the table renders and drops what it does not', () => {
    const stored = [{ field: COLOR, dir: 'asc' }, { field: SIZE, dir: 'asc' }];
    expect(filterSortCols(stored, [SIZE, 'sku', 'stock'])).toEqual([{ field: SIZE, dir: 'asc' }]);
    expect(filterSortCols(stored, [COLOR, SIZE])).toEqual(stored);
    expect(filterSortCols(stored, ['sku'])).toEqual([]);
  });

  test('survives a missing or junk list', () => {
    expect(filterSortCols(undefined, [SIZE])).toEqual([]);
    expect(filterSortCols('nonsense', [SIZE])).toEqual([]);
  });

  test('an axis is one column however the catalogue spells it', () => {
    // Shopify writes "Color", the admin builder lowercases. Both fold to one
    // field, so the arrangement survives moving between those products.
    expect(AXIS_FIELD('Color')).toBe(AXIS_FIELD('color'));
    expect(filterSortCols([{ field: AXIS_FIELD('Color'), dir: 'asc' }], [AXIS_FIELD('color')]))
      .toEqual([{ field: 'attr:color', dir: 'asc' }]);
  });
});

describe('numbers that are not numbers', () => {
  test("'' and 'abc' are unknown, but '0' and '-2' are figures", () => {
    const rows = [
      v('blank', {}, ''), v('text', {}, 'abc'), v('zero', {}, '0'), v('neg', {}, '-2'),
    ];
    expect(skus(rows, variantComparator([{ field: 'stock', dir: 'asc' }])))
      .toEqual(['neg', 'zero', 'blank', 'text']);
  });
});

describe('storage that misbehaves', () => {
  const KEY = 'variantSort.throws';
  afterEach(() => { delete global.window; });

  test('a browser that refuses localStorage still renders (reads [] , writes nothing)', () => {
    global.window = {
      localStorage: {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
        removeItem() { throw new Error('blocked'); },
      },
    };
    expect(readSortCols(KEY)).toEqual([]);
    expect(() => writeSortCols(KEY, [{ field: 'sku', dir: 'asc' }])).not.toThrow();
    expect(() => writeSortCols(KEY, [])).not.toThrow();
  });

  test('no window at all (server-side render, unit runner) is not a crash', () => {
    expect(readSortCols(KEY)).toEqual([]);
    expect(() => writeSortCols(KEY, [{ field: 'sku', dir: 'asc' }])).not.toThrow();
  });
});
