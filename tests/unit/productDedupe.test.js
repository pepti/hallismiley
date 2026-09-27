'use strict';

// The duplicate-product signals (server/utils/productDedupe.js; ported from
// icelandicstore #309/#315, cut to the engine's catalogue — no vendor, product
// type is the "same kind of thing" guard).
const {
  normalizeText, splitColourTail, colourTailFor, gtinKey, gtinValid, skuKey, findDuplicateGroups,
} = require('../../server/utils/productDedupe');

const p = (id, name, extra = {}) => ({ id, slug: id, name, category: 'product', variant_axes: [], variants: [], ...extra });
const groupOf = (groups, id) => groups.find(g => g.products.some(x => x.id === id));

describe('helpers', () => {
  test('normalizeText folds case, accents and punctuation', () => {
    expect(normalizeText('Reykjavík — T-Shirt!')).toBe('reykjavik t shirt');
  });
  test('GTIN: check digit validated, padded to 14', () => {
    expect(gtinValid('5690000000015')).toBe(true);
    expect(gtinValid('5690000000016')).toBe(false);
    expect(gtinKey('569-0000000015')).toBe('05690000000015');
    expect(gtinKey('12345')).toBeNull();
  });
  test('SKU key is case-folded, blank is null', () => {
    expect(skuKey(' AB-1 ')).toBe('ab-1');
    expect(skuKey('')).toBeNull();
  });
  test('splitColourTail needs three segments and a colour-shaped tail', () => {
    expect(splitColourTail('T-Shirt | Classic | Red (RE)')).toEqual({ base: 'T-Shirt | Classic', tail: 'Red (RE)' });
    expect(splitColourTail('T-Shirt | Red')).toBeNull();
    expect(splitColourTail('Poster | Big | this is not a colour at all really')).toBeNull();
  });
  test('a two-segment tail counts only under a colour master it names (ice #315 D)', () => {
    const master = p('m', 'QA Tee', { variant_axes: ['color', 'size'], variants: [{ attributes: { color: 'Blue', size: 'S' } }] });
    expect(colourTailFor('QA Tee | Red (RE)', master)).toEqual({ base: 'QA Tee', tail: 'Red (RE)' });
    expect(colourTailFor('QA Tee | Blue', master)).toEqual({ base: 'QA Tee', tail: 'Blue' });
    expect(colourTailFor('QA Tee | Green', master)).toBeNull();          // no code, not a known colour
    expect(colourTailFor('Postcard | Reykjavik', p('pc', 'Postcard'))).toBeNull();
  });
});

describe('findDuplicateGroups', () => {
  test('barcode on a product and a LIVE variant pairs; on a switched-off variant it does not', () => {
    const rows = [
      p('a', 'Alpha', { barcode: '5690000000015' }),
      p('b', 'Beta', { variants: [{ barcode: '5690000000015', active: true }] }),
      p('c', 'Gamma', { variants: [{ barcode: '5690000000022', active: false }] }),
      p('d', 'Delta', { barcode: '5690000000022' }),
    ];
    const groups = findDuplicateGroups(rows);
    expect(groupOf(groups, 'a').signals).toEqual(['barcode']);
    expect(groupOf(groups, 'a').products.map(x => x.id).sort()).toEqual(['a', 'b']);
    expect(groupOf(groups, 'c')).toBeUndefined();
  });

  test('the same SKU pairs; identical names pair within one product type only', () => {
    const rows = [
      p('a', 'One', { sku: 'X-1' }), p('b', 'Two', { variants: [{ sku: 'x-1' }] }),
      p('c', 'Lopapeysa', {}), p('d', 'lopapeysa!', {}),
      p('e', 'Ráðgjöf', { category: 'tech_service' }), p('f', 'Ráðgjöf', { category: 'carpentry_service' }),
    ];
    const groups = findDuplicateGroups(rows);
    expect(groupOf(groups, 'a').type).toBe('sku');
    expect(groupOf(groups, 'c').type).toBe('identical');
    expect(groupOf(groups, 'e')).toBeUndefined();
  });

  test('a per-colour product goes under the colour-axis master, with the switched-off-row tell', () => {
    const master = p('m', 'T-Shirt | Reykjavik Classic', {
      variant_axes: ['color', 'size'],
      variants: [{ attributes: { color: 'Black', size: 'S' } }, { attributes: { color: 'Red (RE)', size: 'S' }, active: false }],
    });
    const red = p('r', 'T-Shirt | Reykjavik Classic | Red (RE)', { variant_axes: ['size'] });
    const g = findDuplicateGroups([master, red])[0];
    expect(g).toMatchObject({ type: 'colourway', masterId: 'm' });
    expect(g.products.find(x => x.id === 'r')).toMatchObject({ role: 'colourway', colour: 'Red (RE)', archivedColourMatch: true });
  });

  test('per-colour siblings with no master form their own group', () => {
    const rows = [p('g', 'Tee | Wayfinder | Green'), p('b', 'Tee | Wayfinder | Black (BL)'), p('x', 'Mug | Other | Black')];
    const g = groupOf(findDuplicateGroups(rows), 'g');
    expect(g.products.map(x => x.id).sort()).toEqual(['b', 'g']);
    expect(g.masterId).toBeNull();
  });

  test('similar names need ≥ 80 % overlap and are badged as the weakest signal', () => {
    const rows = [p('a', 'Wool Socks Grey Large Warm'), p('b', 'Wool Socks Grey Large Warm Pair'), p('c', 'Wool hat')];
    const g = groupOf(findDuplicateGroups(rows), 'a');
    expect(g.type).toBe('similar');
    expect(g.confidence).toBeGreaterThanOrEqual(0.8);
    expect(groupOf(findDuplicateGroups(rows), 'c')).toBeUndefined();
  });
});
