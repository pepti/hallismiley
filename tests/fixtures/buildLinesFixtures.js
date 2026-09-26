'use strict';

// Inputs for the buildLines parity test (tests/unit/orderVatParity.test.js,
// harvest 2 lane 5). Each case is exactly what invoiceService.buildLines takes.
// buildLinesGolden.json holds the output buildLines produced for these inputs
// BEFORE its VAT core moved to utils/orderVat.js — the refactor must keep it
// byte-for-byte. Never regenerate the golden file from the refactored code.

const item = (price, qty, rate, extra = {}) => ({
  product_id: extra.product_id || `p-${price}-${qty}`,
  sku: extra.sku || null,
  product_name_snapshot: extra.name || `Vara ${price}`,
  product_price_snapshot: price,
  quantity: qty,
  vat_rate: rate,
  is_service: extra.is_service === true,
});

const order = (currency, items, { shipping = 0, shippingDiscount = 0, discount = 0 } = {}) => {
  const subtotal = items.reduce((a, it) => a + it.product_price_snapshot * it.quantity, 0);
  return {
    currency,
    order_number: `FX-${currency}-${subtotal}`,
    subtotal,
    shipping,
    shipping_discount: shippingDiscount,
    discount_amount: discount,
    total: subtotal - discount + shipping - shippingDiscount,
  };
};

function isk(name, items, opts = {}, exportSale = false) {
  return { name, order: order('ISK', items, opts), items, rate: 1, exportSale };
}

function eur(name, items, rate, opts = {}, exportSale = false) {
  return { name, order: order('EUR', items, opts), items, rate, exportSale };
}

const CASES = [
  isk('one standard line', [item(12400, 1, 24)]),
  isk('mixed rates, shipping, both discounts', [
    item(12400, 2, 24), item(4990, 3, 11), item(2500, 1, 0),
  ], { shipping: 1500, shippingDiscount: 500, discount: 3000 }),
  isk('equal lines, a discount that leaves remainders', [
    item(1000, 1, 24, { product_id: 'a' }), item(1000, 1, 11, { product_id: 'b' }), item(1000, 1, 24, { product_id: 'c' }),
  ], { discount: 100 }),
  isk('export: goods zero-rated, a service keeps its rate, shipping zero-rated', [
    item(8900, 2, 24), item(24800, 1, 24, { is_service: true }), item(3100, 1, 11),
  ], { shipping: 2900, discount: 1234 }, true),
  isk('a product with no rate row defaults to 24', [item(12400, 1, null), item(990, 4, 11)], { shipping: 990 }),
  isk('a 100 % discount', [item(5000, 1, 24), item(2000, 2, 11)], { shipping: 1000, shippingDiscount: 1000, discount: 9000 }),
  isk('large order, odd quantities', [
    item(1999, 7, 24), item(349, 13, 11), item(79990, 1, 24), item(5, 1000, 0),
  ], { shipping: 1990, discount: 4321 }),
  eur('translated: one line, shipping', [item(8900, 1, 24)], 150, { shipping: 1500 }),
  eur('translated: units that round, a discount', [
    item(333, 3, 24), item(1250, 2, 11), item(999, 1, 24),
  ], 149.7, { shipping: 990, discount: 450 }),
  eur('translated: rounding shortfall becomes a sléttun line', [
    item(1, 100, 24), item(333, 3, 11),
  ], 149),
  eur('translated export with a service', [
    item(4500, 2, 24), item(12000, 1, 24, { is_service: true }),
  ], 148.25, { shipping: 2000, shippingDiscount: 250, discount: 700 }, true),
];

module.exports = { CASES };
