// Repository for product_variants — per-SKU stock/price.
// Parameterised queries throughout.
const db = require('../config/database');

const COLUMNS = 'id, product_id, sku, attributes, price_isk, price_eur, stock, active, created_at, updated_at';

class ProductVariant {
  // ── READ ──────────────────────────────────────────────────────────────────

  // List variants for a product, ordered by sku for deterministic UI.
  static async listForProduct(productId, { activeOnly = true } = {}) {
    const where = activeOnly ? 'AND active = TRUE' : '';
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM product_variants
        WHERE product_id = $1 ${where}
        ORDER BY sku ASC`,
      [String(productId)]
    );
    return rows;
  }

  static async findById(id) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM product_variants WHERE id = $1`,
      [String(id)]
    );
    return rows[0] || null;
  }

  static async findBySku(sku) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM product_variants WHERE sku = $1`,
      [String(sku)]
    );
    return rows[0] || null;
  }

  // Bulk fetch for checkout — avoid N+1 on the variant lookup.
  static async findByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM product_variants WHERE id = ANY($1::text[])`,
      [ids.map(String)]
    );
    return rows;
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────

  static async create(data) {
    const {
      product_id, sku, attributes,
      price_isk = null, price_eur = null,
      stock = 0, active = true,
    } = data;
    const { rows } = await db.query(
      `INSERT INTO product_variants (product_id, sku, attributes, price_isk, price_eur, stock, active)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [
        String(product_id), String(sku),
        typeof attributes === 'string' ? attributes : JSON.stringify(attributes),
        price_isk === null || price_isk === undefined ? null : Number(price_isk),
        price_eur === null || price_eur === undefined ? null : Number(price_eur),
        Number(stock), Boolean(active),
      ]
    );
    return rows[0];
  }

  // Upsert by (product_id, attributes) — useful for seeding.
  static async upsertByAttrs(data) {
    const {
      product_id, sku, attributes,
      price_isk = null, price_eur = null,
      stock = 0, active = true,
    } = data;
    const attrsJson = typeof attributes === 'string' ? attributes : JSON.stringify(attributes);
    const { rows } = await db.query(
      `INSERT INTO product_variants (product_id, sku, attributes, price_isk, price_eur, stock, active)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
       ON CONFLICT (product_id, attributes) DO UPDATE SET
         sku = EXCLUDED.sku,
         price_isk = EXCLUDED.price_isk,
         price_eur = EXCLUDED.price_eur,
         stock = EXCLUDED.stock,
         active = EXCLUDED.active
       RETURNING ${COLUMNS}`,
      [
        String(product_id), String(sku), attrsJson,
        price_isk === null || price_isk === undefined ? null : Number(price_isk),
        price_eur === null || price_eur === undefined ? null : Number(price_eur),
        Number(stock), Boolean(active),
      ]
    );
    return rows[0];
  }

  static async update(id, data) {
    const allowed = ['sku', 'price_isk', 'price_eur', 'stock', 'active'];
    const numeric = new Set(['price_isk', 'price_eur', 'stock']);
    const bool    = new Set(['active']);

    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (data[f] === undefined) continue;
      let v = data[f];
      if (numeric.has(f)) v = v === null ? null : Number(v);
      if (bool.has(f))    v = Boolean(v);
      params.push(v);
      sets.push(`${f} = $${params.length}`);
    }
    if (sets.length === 0) return ProductVariant.findById(id);
    params.push(String(id));
    const { rows } = await db.query(
      `UPDATE product_variants SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params
    );
    return rows[0] || null;
  }

  // Atomic decrement — same contract as Product.decrementStockAtomic.
  // Returns the new stock on success, null if the guard failed (insufficient).
  static async decrementStockAtomic(client, variantId, qty) {
    const { rows } = await client.query(
      `UPDATE product_variants SET stock = stock - $1
        WHERE id = $2 AND stock >= $1
        RETURNING stock`,
      [Number(qty), String(variantId)]
    );
    return rows[0]?.stock ?? null;
  }

  // Total stock across all active variants of a product. Used to drive
  // aggregate stock badges on grid cards.
  static async totalStockForProduct(productId) {
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(stock), 0)::int AS total
         FROM product_variants
        WHERE product_id = $1 AND active = TRUE`,
      [String(productId)]
    );
    return rows[0].total;
  }
}

module.exports = ProductVariant;
