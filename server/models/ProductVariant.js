// Repository for product_variants — per-SKU stock/price.
// Parameterised queries throughout.
//
// `stock` is not a plain updatable column: a CHANGE moves through
// Inventory.setAbsolute (an inventory_adjustments row naming who moved it), and
// opening stock on create() is recorded as an 'opening' row. models/Inventory.js.
const db = require('../config/database');
const Inventory = require('./Inventory');

const COLUMNS = 'id, product_id, sku, barcode, attributes, price_isk, price_eur, stock, bin, active, archived_at, created_at, updated_at';

class ProductVariant {
  // ── READ ──────────────────────────────────────────────────────────────────
  //
  // Archived rows (migration 119, ported from icelandicstore #194) are
  // deleted-but-still-named-by-an-order. Every LIST excludes them; the by-id
  // lookups deliberately do NOT, so an old order line still resolves the
  // variant it was sold as. SQL order stays SKU (deterministic); the grids
  // and the product page arrange colour → size on the client
  // (public/js/utils/variantArrange.js).

  // List variants for a product, ordered by sku for deterministic UI.
  static async listForProduct(productId, { activeOnly = true } = {}) {
    const where = activeOnly ? 'AND active = TRUE' : '';
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM product_variants
        WHERE product_id = $1 AND archived_at IS NULL ${where}
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
        WHERE product_id = ANY($1::text[]) AND archived_at IS NULL ${where}
        ORDER BY product_id, sku ASC`,
      [productIds.map(String)]
    );
    return rows;
  }

  // Scoped lookup — the way to resolve a :variantId that arrived beside a
  // :productId in the path (ice #194). Archived rows are not editable.
  static async findByIdForProduct(id, productId) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM product_variants
        WHERE id = $1 AND product_id = $2 AND archived_at IS NULL`,
      [String(id), String(productId)]
    );
    return rows[0] || null;
  }

  static async findById(id) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM product_variants WHERE id = $1`,
      [String(id)]
    );
    return rows[0] || null;
  }

  // Since 119 an archived row may share its SKU with a live one; the live row
  // answers for the code.
  static async findBySku(sku) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM product_variants WHERE sku = $1
        ORDER BY (archived_at IS NULL) DESC, created_at DESC LIMIT 1`,
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

  // `client`: run inside the CALLER's transaction (the all-or-nothing batch in
  // services/variantAdd.js) — no BEGIN/COMMIT of its own then.
  static async create(data, { userId = null, client: outer = null } = {}) {
    const {
      product_id, sku, attributes,
      price_isk = null, price_eur = null,
      stock = 0, bin = null, active = true, barcode = null,
    } = data;
    const insert = async (client) => {
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
      return rows[0];
    };
    if (outer) return insert(outer);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await insert(client);
      await client.query('COMMIT');
      return row;
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
    // `attributes` is updatable so a typo ("Blakc" → "Black") is fixed in place
    // (ice #194): order history keeps its own snapshot
    // (order_items.variant_attributes), and uniq_product_variants_attrs_live
    // still refuses a collision with a live sibling (23505 → 409).
    const allowed = ['sku', 'barcode', 'attributes', 'price_isk', 'price_eur', 'bin', 'active'];
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
      if (f === 'attributes') {
        params.push(typeof v === 'string' ? v : JSON.stringify(v));
        sets.push(`attributes = $${params.length}::jsonb`);
        continue;
      }
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

  // ── DELETE (ported from icelandicstore #194) ──────────────────────────────

  // Does anything still name this variant? order_items is ON DELETE RESTRICT
  // and defends itself, but inventory_adjustments is CASCADE: a hard delete of
  // a never-sold variant with stock history would quietly take the audit trail
  // with it. So EVERY foreign key onto product_variants is checked, read from
  // the catalogue rather than listed here — a table added later (goods
  // receipts, counts) is covered the day its migration lands. The list is
  // read once per process: foreign keys change only with a migration, and
  // migrations run before the server boots.
  static async _referencingColumns() {
    if (!ProductVariant._refCols) {
      const { rows } = await db.query(
        `SELECT n.nspname AS schema, t.relname AS tbl, a.attname AS col
           FROM pg_constraint c
           JOIN pg_class t     ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f' AND c.confrelid = 'product_variants'::regclass
          ORDER BY t.relname, a.attname`
      );
      ProductVariant._refCols = rows;
    }
    return ProductVariant._refCols;
  }

  // `runner` = the pool, or a client inside the caller's transaction.
  static async hasReferences(id, runner = db) {
    const cols = await ProductVariant._referencingColumns();
    if (!cols.length) return false;
    // Identifiers come from pg_catalog, never from a request; quoted anyway.
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const exists = cols.map(c => `EXISTS (SELECT 1 FROM ${q(c.schema)}.${q(c.tbl)} WHERE ${q(c.col)} = $1)`);
    const { rows } = await runner.query(`SELECT (${exists.join(' OR ')}) AS referenced`, [String(id)]);
    return rows[0].referenced === true;
  }

  // The DELETE route's one writer: delete, or archive when something names
  // the variant — decided and done in ONE transaction, with the variant row
  // locked FOR UPDATE first (after its product FOR KEY SHARE — the lock order
  // in models/Inventory.js). The stock writers lock the variant row, and an
  // order line's foreign key takes FOR KEY SHARE on it, so a movement or an
  // order cannot land between the check and the delete: without the lock a
  // stock adjustment committed in that gap would be CASCADE-deleted with the
  // variant, the very audit trail the check exists to keep (invariant-reviewer,
  // lane 6c). Returns { deleted: true, id } | { archived: true, variant } | null
  // (not this product's, or already archived).
  static async deleteOrArchive(id, productId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM products WHERE id = $1 FOR KEY SHARE', [String(productId)]);
      const { rows: cur } = await client.query(
        `SELECT id FROM product_variants
          WHERE id = $1 AND product_id = $2 AND archived_at IS NULL FOR UPDATE`,
        [String(id), String(productId)]
      );
      if (!cur[0]) { await client.query('ROLLBACK'); return null; }
      let out;
      if (await ProductVariant.hasReferences(id, client)) {
        const variant = await ProductVariant.archive(id, productId, client);
        out = { archived: true, variant };
      } else {
        await client.query('DELETE FROM product_variants WHERE id = $1', [String(id)]);
        out = { deleted: true, id: String(id) };
      }
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // For a variant something still names: out of every list, both unique slots
  // freed (the indexes are partial on archived_at IS NULL), the row kept for
  // history. Its shelf is cleared too — a deleted variant occupies no bin, and
  // the bin board lists variants without an archive filter. Stock is left as
  // it stands: on hand only moves through models/Inventory.js.
  static async archive(id, productId, runner = db) {
    const { rows } = await runner.query(
      `UPDATE product_variants SET archived_at = NOW(), active = FALSE, bin = NULL
        WHERE id = $1 AND product_id = $2 AND archived_at IS NULL
        RETURNING ${COLUMNS}`,
      [String(id), String(productId)]
    );
    return rows[0] || null;
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
