// Repository pattern for products — all SQL lives here.
// Parameterised queries throughout (A03: prevents SQL injection).
const db = require('../config/database');

const COLUMNS = 'id, slug, name, description, price_isk, price_eur, stock, weight_grams, shape, capacity_litres, category, variant_axes, active, created_at, updated_at';
const IMG_COLUMNS = 'id, product_id, url, position, alt_text, created_at';

class Product {
  // ── READ ──────────────────────────────────────────────────────────────────

  static async findAll({ activeOnly = true, limit = 100, offset = 0 } = {}) {
    const where = activeOnly ? 'WHERE active = TRUE' : '';
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM products ${where}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [Number(limit), Number(offset)]
    );
    return rows;
  }

  static async findBySlug(slug, { activeOnly = true } = {}) {
    const where = activeOnly ? 'AND active = TRUE' : '';
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM products WHERE slug = $1 ${where}`,
      [String(slug)]
    );
    return rows[0] || null;
  }

  static async findById(id, { activeOnly = false } = {}) {
    const where = activeOnly ? 'AND active = TRUE' : '';
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM products WHERE id = $1 ${where}`,
      [String(id)]
    );
    return rows[0] || null;
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────

  static async create(data) {
    const {
      slug, name, description = '',
      price_isk, price_eur,
      stock = 0, weight_grams = null,
      shape = null, capacity_litres = null,
      category = null, variant_axes = [],
      active = true,
    } = data;
    const { rows } = await db.query(
      `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, weight_grams, shape, capacity_litres, category, variant_axes, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
       RETURNING ${COLUMNS}`,
      [
        String(slug), String(name), String(description),
        Number(price_isk), Number(price_eur),
        Number(stock),
        weight_grams === null || weight_grams === undefined ? null : Number(weight_grams),
        shape || null,
        capacity_litres === null || capacity_litres === undefined ? null : Number(capacity_litres),
        category || null,
        typeof variant_axes === 'string' ? variant_axes : JSON.stringify(variant_axes || []),
        Boolean(active),
      ]
    );
    return rows[0];
  }

  static async update(id, data) {
    const allowed = ['slug', 'name', 'description', 'price_isk', 'price_eur', 'stock', 'weight_grams', 'shape', 'capacity_litres', 'category', 'variant_axes', 'active'];
    const numeric = new Set(['price_isk', 'price_eur', 'stock', 'weight_grams', 'capacity_litres']);
    const bool    = new Set(['active']);
    const jsonField = new Set(['variant_axes']);

    const sets   = [];
    const params = [];

    for (const field of allowed) {
      if (data[field] === undefined) continue;
      let v = data[field];
      if (numeric.has(field)) v = v === null ? null : Number(v);
      if (bool.has(field))    v = Boolean(v);
      if (jsonField.has(field)) {
        v = typeof v === 'string' ? v : JSON.stringify(v);
        params.push(v);
        sets.push(`${field} = $${params.length}::jsonb`);
      } else {
        params.push(v);
        sets.push(`${field} = $${params.length}`);
      }
    }

    if (sets.length === 0) return Product.findById(id);

    params.push(String(id));
    const { rows } = await db.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params
    );
    return rows[0] || null;
  }

  static async deactivate(id) {
    return Product.update(id, { active: false });
  }

  // Atomic stock decrement — returns new stock on success, null if insufficient.
  // Must be called from within the caller's transaction (`client` is a
  // pool-acquired client after BEGIN). The WHERE stock >= $qty guard ensures
  // we never oversell under concurrent webhook processing.
  static async decrementStockAtomic(client, productId, qty) {
    const { rows } = await client.query(
      `UPDATE products SET stock = stock - $1
        WHERE id = $2 AND stock >= $1
        RETURNING stock`,
      [Number(qty), String(productId)]
    );
    return rows[0]?.stock ?? null;
  }

  // ── IMAGES ────────────────────────────────────────────────────────────────

  static async listImages(productId) {
    const { rows } = await db.query(
      `SELECT ${IMG_COLUMNS} FROM product_images
        WHERE product_id = $1
        ORDER BY position ASC, created_at ASC`,
      [String(productId)]
    );
    return rows;
  }

  static async addImage(productId, { url, alt_text = null }) {
    const { rows: maxRows } = await db.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM product_images WHERE product_id = $1`,
      [String(productId)]
    );
    const nextPos = maxRows[0].next;
    const { rows } = await db.query(
      `INSERT INTO product_images (product_id, url, position, alt_text)
       VALUES ($1, $2, $3, $4)
       RETURNING ${IMG_COLUMNS}`,
      [String(productId), String(url), Number(nextPos), alt_text]
    );
    return rows[0];
  }

  static async deleteImage(productId, imageId) {
    const { rows } = await db.query(
      `DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING url`,
      [String(imageId), String(productId)]
    );
    return rows[0] || null;
  }

  static async reorderImages(productId, order) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of order) {
        await client.query(
          `UPDATE product_images SET position = $1 WHERE id = $2 AND product_id = $3`,
          [Number(item.position), String(item.id), String(productId)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return Product.listImages(productId);
  }
}

module.exports = Product;
