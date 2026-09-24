// Pure grouping of import rows into "one product with variants" —
// services/productImport/variantGroups (harvested from icelandicstore #302 with
// its test; harvest-ice-d-2026-09-24). No database: the catalogue checks (slug
// taken, name exists, barcode in use) live in the controller and are covered by
// adminProductImportFile.test.js. Engine differences pinned here: the parent
// carries only a name (vendor, VAT, category are ice-only columns), and every
// variant row needs BOTH prices (engine products require price_eur too).
const { buildVariantGroups, refuseGroup, groupKeyFor, foldAxis } = require('../../server/services/productImport/variantGroups');
const { formatVariantCell } = require('../../server/services/productImport/variantCell');

// A row the way the controller hands it over: normalised fields, raw Variant
// cell, optional Slug, and the row's index in the file.
let n = 0;
const row = (over = {}) => {
  const index = n++;
  const fields = { name: 'Viking Tee', vendor: 'Icelandic Store', price_isk: 1990, price_eur: 1400, ...(over.fields || {}) };
  return { index, sku: over.sku || `SKU-${index}`, barcode: over.barcode || '', variant: over.variant || 'Size: M', slug: over.slug || '', fields, error: over.error || null };
};
beforeEach(() => { n = 0; });

const verdictOf = (res, r) => res.byIndex.get(r.index);

describe('groupKeyFor', () => {
  test('an explicit Slug keys the group; otherwise name + vendor, normalised', () => {
    expect(groupKeyFor(row({ slug: 'Viking-Tee' }))).toBe('slug:viking-tee');
    expect(groupKeyFor(row())).toBe('name:viking tee|icelandic store');
    expect(groupKeyFor(row({ fields: { name: '  VIKING   Tee ', vendor: 'icelandic store' } }))).toBe('name:viking tee|icelandic store');
    expect(groupKeyFor(row({ fields: { name: 'Viking Tee', vendor: undefined } }))).toBe('name:viking tee|');
  });
  test('no name and no slug → no key', () => {
    expect(groupKeyFor(row({ fields: { name: undefined } }))).toBeNull();
  });
});

describe('foldAxis — the import-boundary synonym fold, and nothing else', () => {
  test('Stærð / Size / Str → size; Litur / Colour / Color → color; anything else lower-cased', () => {
    expect(foldAxis('Stærð')).toBe('size');
    expect(foldAxis('SIZE')).toBe('size');
    expect(foldAxis('Litur')).toBe('color');
    expect(foldAxis('Colour')).toBe('color');
    expect(foldAxis('Material')).toBe('material');
  });
});

describe('buildVariantGroups — the happy grid', () => {
  test('rows sharing a name + vendor become one group with the union of axes, in first-seen order', () => {
    const rows = [
      row({ sku: 'TEE-S-BLK', variant: 'Size: S, Color: Black', fields: { stock: 5, barcode: '700001' } }),
      row({ sku: 'TEE-M-BLK', variant: 'Size: M, Color: Black', fields: { stock: 0 } }),
      row({ sku: 'TEE-M-RED', variant: 'Color: Red, Size: M', fields: { price_isk: 2190, active: true } }),
    ];
    const res = buildVariantGroups(rows);
    expect(res.groups).toHaveLength(1);
    const g = res.groups[0];
    expect(g.ok).toBe(true);
    expect(g.axes).toEqual(['size', 'color']);
    expect(g.name).toBe('Viking Tee');
    // Parent: cheapest prices, Draft because not every row said Active.
    expect(g.parent).toMatchObject({ name: 'Viking Tee', price_isk: 1990, price_eur: 1400, active: false });
    expect(g.variants).toEqual([
      expect.objectContaining({ sku: 'TEE-S-BLK', attributes: { size: 'S', color: 'Black' }, price_isk: 1990, stock: 5, barcode: '700001' }),
      expect.objectContaining({ sku: 'TEE-M-BLK', attributes: { size: 'M', color: 'Black' }, stock: 0 }),
      expect.objectContaining({ sku: 'TEE-M-RED', attributes: { size: 'M', color: 'Red' }, price_isk: 2190, active: true }),
    ]);
    for (const r of rows) expect(verdictOf(res, r)).toMatchObject({ ok: true, group: g });
  });

  test('Active only when every row says so', () => {
    const rows = [
      row({ sku: 'A', variant: 'Size: S', fields: { active: true } }),
      row({ sku: 'B', variant: 'Size: M', fields: { active: true } }),
    ];
    expect(buildVariantGroups(rows).groups[0].parent.active).toBe(true);
  });

  test('a supplier grid: Stærð / Litur keys in the Variant cell fold to size / color', () => {
    const rows = [
      row({ sku: 'A', variant: formatVariantCell({ size: 'S', color: 'Svart' }) }),
      row({ sku: 'B', variant: 'Stærð: M, Litur: Svart' }),
    ];
    const g = buildVariantGroups(rows).groups[0];
    expect(g.ok).toBe(true);
    expect(g.axes).toEqual(['size', 'color']);
    expect(g.variants[1].attributes).toEqual({ size: 'M', color: 'Svart' });
  });

  test('round trip: what the export writes for a created group reads back identically', () => {
    const rows = [
      row({ sku: 'A', variant: 'Size: S, Color: Black' }),
      row({ sku: 'B', variant: 'Size: M, Color: Black, matte' }),
    ];
    const g = buildVariantGroups(rows).groups[0];
    expect(g.ok).toBe(true);
    for (const v of g.variants) {
      const cell = formatVariantCell(v.attributes, g.axes);
      const again = buildVariantGroups([row({ sku: v.sku, variant: cell })]).groups[0];
      expect(again.variants[0].attributes).toEqual(v.attributes);
    }
  });

  test('two products in one file are two groups; a Slug-keyed group and a name-keyed group stay apart', () => {
    const rows = [
      row({ sku: 'A', variant: 'Size: S' }),
      row({ sku: 'B', variant: 'Size: S', fields: { name: 'Puffin Tee' } }),
      row({ sku: 'C', variant: 'Size: M', slug: 'viking-tee' }),
    ];
    const res = buildVariantGroups(rows);
    expect(res.groups.map(g => g.key)).toEqual(['name:viking tee|icelandic store', 'name:puffin tee|icelandic store', 'slug:viking-tee']);
    expect(res.groups.every(g => g.ok)).toBe(true);
  });
});

describe('buildVariantGroups — one bad row refuses the whole product', () => {
  test('an unreadable Variant cell: that row variant_invalid, the siblings group_refused', () => {
    const rows = [row({ sku: 'A', variant: 'Size: S' }), row({ sku: 'B', variant: 'Medium' })];
    const res = buildVariantGroups(rows);
    expect(res.groups[0].ok).toBe(false);
    expect(res.groups[0].variants).toEqual([]);
    expect(verdictOf(res, rows[1])).toMatchObject({ ok: false, reason: 'variant_invalid' });
    expect(verdictOf(res, rows[0])).toMatchObject({ ok: false, reason: 'group_refused' });
  });

  test('a row that failed normalisation carries its own reason into the group', () => {
    const rows = [
      row({ sku: 'A', variant: 'Size: S' }),
      row({ sku: 'B', variant: 'Size: M', fields: null, error: { reason: 'invalid_value', errorField: 'Price ISK' } }),
    ];
    const res = buildVariantGroups(rows);
    expect(verdictOf(res, rows[1])).toMatchObject({ ok: false, reason: 'invalid_value', errorField: 'Price ISK' });
    expect(verdictOf(res, rows[0])).toMatchObject({ ok: false, reason: 'group_refused' });
  });

  // QA 2026-09-13 A3: every row refused up front left the heading nameless.
  test('a group whose every row was refused before grouping still carries the name its rows give', () => {
    const rows = [0, 1, 2].map(i => row({
      sku: 'QA0913-A1', variant: `size: ${['S', 'M', 'L'][i]}`,
      fields: { name: 'QA 0913 Lopapeysa Hekla', vendor: undefined, price_isk: undefined },
      error: { reason: 'duplicate_sku' },
    }));
    const res = buildVariantGroups(rows);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]).toMatchObject({ ok: false, name: 'QA 0913 Lopapeysa Hekla', variants: [] });
    for (const r of rows) expect(verdictOf(res, r)).toMatchObject({ ok: false, reason: 'duplicate_sku' });
  });

  test('a variant row without a price', () => {
    const rows = [row({ sku: 'A', variant: 'Size: S' }), row({ sku: 'B', variant: 'Size: M', fields: { price_isk: undefined } })];
    const res = buildVariantGroups(rows);
    expect(verdictOf(res, rows[1])).toMatchObject({ ok: false, reason: 'variant_price_required', errorField: 'price_isk' });
  });

  test('engine: a variant row without a EUR price', () => {
    const rows = [row({ sku: 'A', variant: 'Size: S' }), row({ sku: 'B', variant: 'Size: M', fields: { price_eur: undefined } })];
    const res = buildVariantGroups(rows);
    expect(verdictOf(res, rows[1])).toMatchObject({ ok: false, reason: 'variant_price_required', errorField: 'price_eur' });
    expect(verdictOf(res, rows[0])).toMatchObject({ ok: false, reason: 'group_refused' });
  });

  test('a row missing an axis the others carry names the axis', () => {
    const rows = [row({ sku: 'A', variant: 'Size: S, Color: Black' }), row({ sku: 'B', variant: 'Size: M' })];
    const res = buildVariantGroups(rows);
    expect(verdictOf(res, rows[1])).toMatchObject({ ok: false, reason: 'variant_axes_mismatch', errorField: 'color' });
  });

  test('the same combination twice — compared the way the catalogue compares (case, whitespace, colour codes)', () => {
    const rows = [row({ sku: 'A', variant: 'Size: M, Color: Black (BL)' }), row({ sku: 'B', variant: 'size: m, color: black' })];
    const res = buildVariantGroups(rows);
    expect(verdictOf(res, rows[1])).toMatchObject({ ok: false, reason: 'variant_duplicate' });
  });

  test('a Stærð key and a Size key in one cell are the same axis twice', () => {
    const rows = [row({ sku: 'A', variant: 'Size: M, Stærð: L' })];
    expect(verdictOf(buildVariantGroups(rows), rows[0])).toMatchObject({ ok: false, reason: 'variant_invalid' });
  });

  test('parent-level fields must agree: the disagreeing row names the field', () => {
    // Engine: the parent carries only a name, so a conflict needs a Slug-keyed
    // group whose rows name the product differently.
    const rows = [
      row({ sku: 'A', variant: 'Size: S', slug: 'viking-tee' }),
      row({ sku: 'B', variant: 'Size: M', slug: 'viking-tee', fields: { name: 'Víkingabolur' } }),
      row({ sku: 'C', variant: 'Size: L', slug: 'viking-tee' }),
    ];
    const res = buildVariantGroups(rows);
    expect(verdictOf(res, rows[1])).toMatchObject({ ok: false, reason: 'group_field_conflict', errorField: 'name' });
    expect(verdictOf(res, rows[2])).toMatchObject({ ok: false, reason: 'group_refused' });
  });

  test('a Slug-keyed group whose rows never name the product', () => {
    const rows = [row({ sku: 'A', variant: 'Size: S', slug: 'mystery', fields: { name: undefined } })];
    expect(verdictOf(buildVariantGroups(rows), rows[0])).toMatchObject({ ok: false, reason: 'create_missing_fields', errorField: 'name' });
  });

  test('a row with neither name nor slug is not a group at all', () => {
    const rows = [row({ sku: 'A', variant: 'Size: S', fields: { name: undefined } })];
    const res = buildVariantGroups(rows);
    expect(res.groups).toEqual([]);
    expect(verdictOf(res, rows[0])).toMatchObject({ ok: false, group: null, reason: 'create_missing_fields' });
  });
});

describe('refuseGroup — the controller\'s after-the-fact refusals', () => {
  test('without an index every row gets the reason; with one, only that row does', () => {
    const rows = [row({ sku: 'A', variant: 'Size: S' }), row({ sku: 'B', variant: 'Size: M' })];
    const res = buildVariantGroups(rows);
    const g = res.groups[0];
    refuseGroup(g, res.byIndex, 'group_exists');
    expect(g.ok).toBe(false);
    expect(g.variants).toEqual([]);
    expect(verdictOf(res, rows[0])).toMatchObject({ ok: false, reason: 'group_exists' });
    expect(verdictOf(res, rows[1])).toMatchObject({ ok: false, reason: 'group_exists' });

    const res2 = buildVariantGroups(rows);
    refuseGroup(res2.groups[0], res2.byIndex, 'sku_taken', { index: rows[1].index });
    expect(verdictOf(res2, rows[1])).toMatchObject({ ok: false, reason: 'sku_taken' });
    expect(verdictOf(res2, rows[0])).toMatchObject({ ok: false, reason: 'group_refused' });
  });
});
