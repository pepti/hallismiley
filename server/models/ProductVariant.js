// Repository for product_variants — per-SKU stock/price.
// Parameterised queries throughout.
//
// `stock` is not a plain updatable column: a CHANGE moves through
// Inventory.setAbsolute (an inventory_adjustments row naming who moved it), and
// opening stock on create() is recorded as an 'opening' row. models/Inventory.js.
const db = require('../config/database');
const Inventory = require('./Inventory');

const COLUMNS = 'id, product_id, sku, barcode, attributes, price_isk, price_eur, stock, bin, active, created_at, updated_at';

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

  // Bulk fetch across multiple products — avoids N+1 on list endpoints.
  // Caller groups by product_id; ordering preserves per-product sku order.
  static async listForProducts(productIds, { activeOnly = true } = {}) {
    if (!productIds || productIds.length === 0) return [];
    const where = activeOnly ? 'AND active = TRUE' : '';
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM product_variants
        WHERE product_id = ANY($1::text[]) ${where}
        ORDER BY product_id, sku ASC`,
      [productIds.map(String)]
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

  static async create(data, { userId = null } = {}) {
    const {
      product_id, sku, attributes,
      price_isk = null, price_eur = null,
      stock = 0, bin = null, active = true, barcode = null,
    } = data;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
      `INSERT INTO product_variants (product_id, sku, attributes, price_isk, price_eur, stock, bin, active, barcode)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        String(product_id), String(sku),
        typeof attributes === 'string' ? attributes : JSON.stringify(attributes),
        price_isk === null || price_isk === undefined ? null : Number(price_isk),
        price_eur === null || price_eur === undefined ? null : Number(price_eur),
        Number(stock), bin || null, Boolean(active),
        barcode || null,
      ]
      );
      await Inventory.recordOpening(client, {
        productId: rows[0].product_id, variantId: rows[0].id, stock: rows[0].stock, userId,
      });
      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // There is deliberately NO upsert here. One used to exist (upsertByAttrs,
  // "useful for seeding") with `stock = EXCLUDED.stock` in its DO UPDATE — an
  // unaudited absolute stock overwrite with no caller (removed in icelandicstore
  // #275 for the same reason). If one is ever needed, it must leave stock alone
  // and let Inventory.applyLines move it.

  // `stock` is accepted but moves through Inventory.setAbsolute in a
  // transaction that locks the parent product FOR KEY SHARE, then the variant
  // FOR UPDATE (the lock order in models/Inventory.js) — the variant grid in the
  // product editor PATCHes one cell at a time, stock among them, and before
  // this each such edit was a blind absolute overwrite (ice #275).
  static async update(id, data, { userId = null, stockReason = 'correction', stockNote = null } = {}) {
    const allowed = ['sku', 'barcode', 'price_isk', 'price_eur', 'bin', 'active'];
    // No 'stock' here: it is not in `allowed`, so the loop below never sees it.
    const numeric = new Set(['price_isk', 'price_eur']);
    const bool    = new Set(['active']);
    // A variant of a merged product is frozen with it (migration 120; MCP
    // set_stock, the import and the variant grid all come through here).
    const { rows: owner } = await db.query('SELECT product_id FROM product_variants WHERE id = $1', [String(id)]);
    if (owner[0]) await require('./Product').assertNotMerged(owner[0].product_id);

    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (data[f] === undefined) continue;
      let v = data[f];
      if (numeric.has(f)) v = v === null ? null : Number(v);
      if (bool.has(f))    v = Boolean(v);
      // Empty bin / barcode clears back to NULL (keeps the partial indexes sparse).
      if ((f === 'bin' || f === 'barcode') && typeof v === 'string' && v.trim() === '') v = null;
      params.push(v);
      sets.push(`${f} = $${params.length}`);
    }
    const wantsStock = data.stock !== undefined && data.stock !== null && data.stock !== '';

    if (!wantsStock) {
      if (sets.length === 0) return ProductVariant.findById(id);
      params.push(String(id));
      const { rows } = await db.query(
        `UPDATE product_variants SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
        params
      );
      return rows[0] || null;
    }

    const target = Number(data.stock);
    if (!Number.isInteger(target) || target < 0) {
      const err = new Error('stock must be a whole number of 0 or more');
      err.status = 400;
      throw err;
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // The parent FOR KEY SHARE and the variant FOR UPDATE, in ONE lock order,
      // with no unlocked pre-read that could disagree with the row locked.
      await client.query(
        `SELECT id FROM products
          WHERE id = (SELECT product_id FROM product_variants WHERE id = $1)
          FOR KEY SHARE`,
        [String(id)]
      );
      const { rows: cur } = await client.query(
        'SELECT stock, product_id FROM product_variants WHERE id = $1 FOR UPDATE', [String(id)]
      );
      if (!cur[0]) { await client.query('ROLLBACK'); return null; }
      if (sets.length) {
        params.push(String(id));
        await client.query(`UPDATE product_variants SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      }
      await Inventory.setAbsolute(client, {
        productId: cur[0].product_id, variantId: String(id),
        previous: cur[0].stock, target,
        reason: stockReason || 'correction', note: stockNote, userId,
      });
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
    return ProductVariant.findById(id);
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
