'use strict';

// public/js/utils/duplicateNames.js — which products in a list share a name
// with a DIFFERENT product, so the shop card can show the SKU under it.
// Ported from icelandicstore #399 (tests/unit/duplicateNames.client.test.js),
// plus the card's own rendering of the chip.

const { duplicateNameIds } = require('../../public/js/utils/duplicateNames.js');

const byName = (r) => r.name;
const byId = (r) => r.id;

describe('duplicateNameIds', () => {
  test('two products with one name are both flagged; a unique name is not', () => {
    const rows = [
      { id: 'a', name: 'Postcard | Gullfoss' },
      { id: 'b', name: 'Postcard | Gullfoss' },
      { id: 'c', name: 'Postcard | Puffin' },
    ];
    expect([...duplicateNameIds(rows, byName, byId)].sort()).toEqual(['a', 'b']);
  });

  test('rows of ONE product never flag each other', () => {
    const rows = [{ id: 'tee', name: 'T-Shirt' }, { id: 'tee', name: 'T-Shirt' }];
    expect(duplicateNameIds(rows, byName, byId).size).toBe(0);
  });

  test('names compare case- and whitespace-insensitively, Icelandic letters included', () => {
    const rows = [{ id: 1, name: 'Þórsmörk  Mug' }, { id: 2, name: 'þórsmörk mug ' }];
    expect([...duplicateNameIds(rows, byName, byId)].sort()).toEqual(['1', '2']);
  });

  test('blank names and empty lists flag nothing', () => {
    expect(duplicateNameIds([{ id: 'a', name: '' }, { id: 'b', name: '  ' }], byName, byId).size).toBe(0);
    expect(duplicateNameIds(null, byName, byId).size).toBe(0);
  });
});

describe('ProductCard SKU chip', () => {
  // ProductCard imports the cart (localStorage) and i18n; stub both.
  jest.mock('../../public/js/services/cart.js', () => ({
    formatMoney: (n) => `${n} kr.`, getCurrency: () => 'ISK',
  }));
  jest.mock('../../public/js/i18n/i18n.js', () => ({ t: (k) => k, href: (p) => p }));

  let renderProductCard;
  beforeAll(() => {
    // A minimal element: renderProductCard sets className/href/attributes and innerHTML.
    global.document = {
      createElement: () => ({ setAttribute() {}, innerHTML: '' }),
    };
    ({ renderProductCard } = require('../../public/js/components/ProductCard.js'));
  });
  afterAll(() => { delete global.document; });

  const product = { id: 'p1', slug: 'gullfoss', name: 'Gullfoss', price_isk: 500, available: 5, sku: 'PC-GUL-01' };

  test('no chip unless the caller says the name collides', () => {
    expect(renderProductCard(product).innerHTML).not.toContain('card-dup-sku');
  });

  test('the chip carries the product SKU, escaped', () => {
    const html = renderProductCard({ ...product, sku: 'A<B' }, { showSku: true }).innerHTML;
    expect(html).toContain('data-testid="card-dup-sku"');
    expect(html).toContain('A&lt;B');
  });

  test('a variant product with no own SKU falls back to its first variant SKU', () => {
    const html = renderProductCard({ ...product, sku: null, variants: [{ sku: null }, { sku: 'V-2' }] }, { showSku: true }).innerHTML;
    expect(html).toContain('V-2');
  });
});
