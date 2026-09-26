'use strict';

// The pure merge planner (services/productMerge/planner.js; ported from
// icelandicstore #311/#315, cut to the engine: no add-axis, stock always moves).
const { plan, propose } = require('../../server/services/productMerge/planner');

const prod = (id, extra = {}) => ({
  id, slug: id, name: id, price_isk: 1000, price_eur: 700, vat_rate: 24, stock: 0, active: true,
  is_bookable: false, category: 'product', variant_axes: [], variants: [], ...extra,
});
const v = (id, attributes, extra = {}) => ({ id, sku: id.toUpperCase(), attributes, stock: 0, active: true, ...extra });
const codes = (r) => r.refusals.map(x => x.code);

describe('propose', () => {
  test('simple into simple → the master itself', () => {
    const state = { master: prod('m'), sources: [prod('s', { stock: 3 })], variantSkus: new Map() };
    expect(propose(state).variant_map).toEqual([{ source: { productId: 's', variantId: null }, target: { master: true } }]);
  });

  test('barcode first, then attributes + the name colour; an ambiguous match is left to the admin', () => {
    const master = prod('m', { name: 'Tee | Classic', variant_axes: ['color', 'size'], variants: [
      v('m1', { color: 'Red', size: 'S' }, { barcode: '111' }),
      v('m2', { color: 'Red', size: 'M' }),
    ] });
    const source = prod('s', { name: 'Tee | Classic | Red', variant_axes: ['size'], variants: [
      v('s1', { size: 'XL' }, { barcode: '111' }), v('s2', { size: 'M' }), v('s3', { size: 'L' }),
    ] });
    const map = propose({ master, sources: [source] }).variant_map;
    const t = Object.fromEntries(map.map(e => [e.source.variantId, e.target]));
    expect(t.s1).toEqual({ variantId: 'm1' });
    expect(t.s2).toEqual({ variantId: 'm2' });
    expect(t.s3).toEqual({ attributes: { color: 'Red', size: 'L' } });
  });
});

describe('plan', () => {
  const simpleState = () => ({ master: prod('m', { stock: 1 }), sources: [prod('s', { stock: 4 })], variantSkus: new Map() });

  test('ok plan carries an expect token that changes when a row changes', () => {
    const st = simpleState();
    const req = { variant_map: propose(st).variant_map };
    const a = plan(st, req);
    expect(a.ok).toBe(true);
    expect(a.summary).toMatchObject({ into_master: 1, stockMoved: 4 });
    st.sources[0].stock = 5;
    expect(plan(st, req).expect).not.toBe(a.expect);
  });

  test('refusals: unmapped, merged, VAT, bookable, variant into simple, collisions', () => {
    const st = simpleState();
    expect(codes(plan(st, { variant_map: [] }))).toContain('unit_unmapped');
    st.sources[0].merged_into_id = 'x';
    st.sources[0].vat_rate = 11;
    st.sources[0].is_bookable = true;
    const r = plan(st, { variant_map: propose(st).variant_map });
    expect(codes(r)).toEqual(expect.arrayContaining(['already_merged', 'vat_mismatch', 'bookable_mismatch']));

    const withVariant = { master: prod('m'), sources: [prod('s', { variant_axes: ['size'], variants: [v('s1', { size: 'S' })] })] };
    expect(codes(plan(withVariant, { variant_map: [{ source: { productId: 's', variantId: 's1' }, target: { master: true } }] })))
      .toContain('master_simple_variants');

    const master = prod('m', { variant_axes: ['size'], variants: [v('m1', { size: 'S' })] });
    const src = prod('s', { variant_axes: ['size'], variants: [v('s1', { size: 's' })] });
    const col = plan({ master, sources: [src] }, { variant_map: [{ source: { productId: 's', variantId: 's1' }, target: { attributes: { size: 'S' } } }] });
    expect(codes(col)).toContain('attribute_collision');
  });

  test('a new variant on the attributes of a SWITCHED-OFF survivor row is refused (the unique index covers it)', () => {
    const master = prod('m', { variant_axes: ['color', 'size'], variants: [
      v('m1', { color: 'Black', size: 'S' }), v('old', { color: 'Grá (GR)', size: 'S' }, { active: false }),
    ] });
    const src = prod('s', { name: 'Tee | x | Grá (GR)', variant_axes: ['size'], variants: [v('s1', { size: 'S' })] });
    const r = plan({ master, sources: [src] }, { variant_map: [{ source: { productId: 's', variantId: 's1' }, target: { attributes: { color: 'Grá (GR)', size: 'S' } } }] });
    expect(r.refusals).toEqual([expect.objectContaining({ code: 'attribute_collision_inactive', variantId: 'old' })]);
  });

  test('a simple source into a variant master becomes a new variant; its SKU must be free', () => {
    const master = prod('m', { variant_axes: ['size'], variants: [v('m1', { size: 'S' })] });
    const src = prod('s', { sku: 'TAKEN', stock: 2 });
    const req = { variant_map: [{ source: { productId: 's', variantId: null }, target: { attributes: { size: 'M' } } }] };
    const ok = plan({ master, sources: [src], variantSkus: new Map() }, req);
    expect(ok.ok).toBe(true);
    expect(ok.units[0]).toMatchObject({ kind: 'new', newSku: 'TAKEN', newAttributes: { size: 'M' } });
    const clash = plan({ master, sources: [src], variantSkus: new Map([['taken', 'other']]) }, req);
    expect(codes(clash)).toContain('sku_collision');
  });

  test('a map onto a row with an IDENTICAL twin is refused; a folded look-alike only warns', () => {
    const master = prod('m', { variant_axes: ['color'], variants: [
      v('a', { color: 'Red (RE)' }), v('b', { color: 'red (re)' }), v('c', { color: 'Red' }),
    ] });
    const src = prod('s', { variant_axes: ['color'], variants: [v('s1', { color: 'Red (RE)' })] });
    const onTwin = plan({ master, sources: [src] }, { variant_map: [{ source: { productId: 's', variantId: 's1' }, target: { variantId: 'a' } }] });
    expect(codes(onTwin)).toContain('master_variants_inconsistent');
    const onLookAlike = plan({ master, sources: [src] }, { variant_map: [{ source: { productId: 's', variantId: 's1' }, target: { variantId: 'c' } }] });
    expect(onLookAlike.ok).toBe(true);
    expect(onLookAlike.warnings.map(w => w.code)).toContain('master_variants_inconsistent');
  });
});
