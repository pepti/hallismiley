// Sold out — the products the shop cannot sell another unit of right now
// (harvest 2 lane 5, 2026-09-26; the "Uppselt" attention card of icelandicstore
// #417, on the engine's own stock model).
//
// ONE definition, used by both the "Í dag" card (services/adminHome.js) and the
// product list's ?stock=out filter (adminShopController.listProducts), so the
// number on the card is exactly the rows its link opens:
//   an ACTIVE product in the goods section (category 'product', not a bookable
//   service — services are not stock-limited) whose AVAILABLE quantity is 0 or
//   less — on hand minus what paid, unshipped orders already hold
//   (models/Inventory.js, the product-level rollup the list shows: a variant
//   product's on hand is its active variants' stock summed).
// Product level on purpose: the list is a list of products. A product with one
// sold-out size of several is not "sold out" here; per-unit cover is the
// inventory watch's job (harvest 2 lane 6a).
const db = require('../config/database');
const Inventory = require('./Inventory');

class StockOut {
  /** Ids of the sold-out products, newest first (the product list's order). */
  static async productIds() {
    const { rows: products } = await db.query(
      `SELECT id, stock, variant_axes, created_at FROM products
        WHERE active = TRUE AND category = 'product' AND NOT COALESCE(is_bookable, FALSE)
        ORDER BY created_at DESC, id`
    );
    if (!products.length) return [];
    const { rows: variants } = await db.query(
      `SELECT id, product_id, stock, active FROM product_variants WHERE product_id = ANY($1::text[])`,
      [products.map(p => p.id)]
    );
    const byProduct = new Map();
    for (const v of variants) {
      const list = byProduct.get(v.product_id);
      if (list) list.push(v); else byProduct.set(v.product_id, [v]);
    }
    for (const p of products) p.variants = byProduct.get(p.id) || [];
    await Inventory.decorate(products);
    return products.filter(p => p.available <= 0).map(p => p.id);
  }

  static async count() {
    return (await StockOut.productIds()).length;
  }
}

module.exports = StockOut;
