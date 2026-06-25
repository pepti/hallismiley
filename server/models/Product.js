// Repository pattern for products — all SQL lives here.
// Parameterised queries throughout (A03: prevents SQL injection).
const db = require('../config/database');

// Admin-facing column list: surfaces both locales' raw fields so the CMS
// editor can render EN + IS inputs side-by-side.
const COLUMNS = 'id, slug, name, description, name_is, description_is, price_isk, price_eur, stock, weight_grams, shape, capacity_litres, category, subcategory, duration_minutes, delivery_format, is_bookable, variant_axes, sku, barcode, bin, active, created_at, updated_at';
const IMG_COLUMNS = 'id, product_id, url, position, alt_text, created_at';

// Public-facing column list: COALESCE the IS sibling columns into the primary
// field names so callers see `name` / `description` in the reader's language.
function publicCols(locale) {
  if (locale === 'is') {
    return `id, slug,
            COALESCE(name_is,        name)        AS name,
            COALESCE(description_is, description) AS description,
            price_isk, price_eur, stock, weight_grams, shape, capacity_litres,
            category, subcategory, duration_minutes, delivery_format, is_bookable,
            variant_axes, sku, barcode, bin, active, created_at, updated_at`;
  }
  return 'id, slug, name, description, price_isk, price_eur, stock, weight_grams, shape, capacity_litres, category, subcategory, duration_minutes, delivery_format, is_bookable, variant_axes, sku, barcode, bin, active, created_at, updated_at';
}

class Product {
  // ── READ ──────────────────────────────────────────────────────────────────

  static async findAll({ activeOnly = true, limit = 100, offset = 0, locale = null, category = null } = {}) {
    const cols  = locale ? publicCols(locale) : COLUMNS;
    // Build WHERE incrementally so the `category` filter is optional and the
    // generated SQL is identical to the old shape when it's not used.
    const conds  = [];
    const params = [];
    if (activeOnly) conds.push('active = TRUE');
    if (category != null) {
      params.push(String(category));
      conds.push(`category = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(Number(limit), Number(offset));
    const { rows } = await db.query(
      `SELECT ${cols} FROM products ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows;
  }

  static async findBySlug(slug, { activeOnly = true, locale = null } = {}) {
    const where = activeOnly ? 'AND active = TRUE' : '';
    const cols  = locale ? publicCols(locale) : COLUMNS;
    const { rows } = await db.query(
      `SELECT ${cols} FROM products WHERE slug = $1 ${where}`,
      [String(slug)]
    );
    return rows[0] || null;
  }

  static async findById(id, { activeOnly = false, locale = null } = {}) {
    const where = activeOnly ? 'AND active = TRUE' : '';
    const cols  = locale ? publicCols(locale) : COLUMNS;
    const { rows } = await db.query(
      `SELECT ${cols} FROM products WHERE id = $1 ${where}`,
      [String(id)]
    );
    return rows[0] || null;
  }

  // Bulk fetch — avoids N+1 on checkout when validating a cart of variants.
  static async findByIds(ids, { activeOnly = false, locale = null } = {}) {
    if (!ids || ids.length === 0) return [];
    const where = activeOnly ? 'AND active = TRUE' : '';
    const cols  = locale ? publicCols(locale) : COLUMNS;
    const { rows } = await db.query(
      `SELECT ${cols} FROM products WHERE id = ANY($1::text[]) ${where}`,
      [ids.map(String)]
    );
    return rows;
  }

  // Resolve a scanned SKU / barcode to a single product or variant, variant-first
  // (a scanned variant code resolves to that exact variant with its OWN
  // stock/bin). Returns a lean camelCase shape (display-ready) or null on no
  // match. Stock/bin are read server-side; never trust a client snapshot. Ported
  // from the sibling icelandicstore Product.resolveByCode, trimmed of the
  // pack_qty/cost_isk columns HalliProjects' schema doesn't have. Note: variants
  // here carry sku + bin but NO barcode of their own, so barcode is the parent
  // product's and a scanned barcode resolves at step 2.
  static async resolveByCode(code) {
    const c = String(code == null ? '' : code).trim();
    if (!c) return null;

    // 1) A variant whose own sku matches wins (variant precedence).
    const { rows: v } = await db.query(
      `SELECT v.id AS variant_id, v.product_id, p.name, p.slug,
              COALESCE(v.sku, p.sku)             AS sku,
              COALESCE(v.bin, p.bin)             AS bin,
              p.barcode                          AS barcode,
              COALESCE(v.price_isk, p.price_isk) AS price_isk,
              COALESCE(v.price_eur, p.price_eur) AS price_eur,
              v.stock, v.attributes,
              (p.active AND v.active) AS active
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.sku = $1
        LIMIT 1`,
      [c]
    );
    if (v[0]) return Product._scanShape(v[0], v[0].variant_id, v[0].attributes);

    // 2) Otherwise a product-level sku/barcode match (single-SKU products).
    const { rows: p } = await db.query(
      `SELECT id AS product_id, slug, name, sku, bin, barcode,
              price_isk, price_eur, stock, active
         FROM products
        WHERE sku = $1 OR barcode = $1
        LIMIT 1`,
      [c]
    );
    if (p[0]) return Product._scanShape(p[0], null, null);

    return null;
  }

  // Normalise a scan row (variant or product) into the camelCase shape the BIN
  // System surfaces consume. Integer money/stock.
  static _scanShape(r, variantId, attributes) {
    return {
      productId:  r.product_id,
      variantId:  variantId || null,
      slug:       r.slug || null,
      name:       r.name,
      sku:        r.sku || null,
      bin:        r.bin || null,
      barcode:    r.barcode || null,
      priceIsk:   r.price_isk == null ? null : Number(r.price_isk),
      priceEur:   r.price_eur == null ? null : Number(r.price_eur),
      stock:      r.stock == null ? null : Number(r.stock),
      active:     Boolean(r.active),
      attributes: attributes || null,
    };
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────

  static async create(data) {
    const {
      slug, name, description = '',
      name_is = null, description_is = null,
      price_isk, price_eur,
      stock = 0, weight_grams = null,
      shape = null, capacity_litres = null,
      // Shop redesign: new top-level category defaults to 'product' to match
      // the DB default. Subcategory holds the pre-redesign apparel-style tag.
      category = 'product', subcategory = null,
      duration_minutes = null, delivery_format = null, is_bookable = false,
      variant_axes = [],
      sku = null, barcode = null, bin = null,
      active = true,
    } = data;
    const { rows } = await db.query(
      `INSERT INTO products (slug, name, description, name_is, description_is,
                             price_isk, price_eur, stock, weight_grams, shape, capacity_litres,
                             category, subcategory, duration_minutes, delivery_format, is_bookable,
                             variant_axes, sku, barcode, bin, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21)
       RETURNING ${COLUMNS}`,
      [
        String(slug), String(name), String(description),
        name_is || null,
        description_is || null,
        Number(price_isk), Number(price_eur),
        Number(stock),
        weight_grams === null || weight_grams === undefined ? null : Number(weight_grams),
        shape || null,
        capacity_litres === null || capacity_litres === undefined ? null : Number(capacity_litres),
        category || 'product',
        subcategory || null,
        duration_minutes === null || duration_minutes === undefined || duration_minutes === ''
          ? null : Number(duration_minutes),
        delivery_format || null,
        Boolean(is_bookable),
        typeof variant_axes === 'string' ? variant_axes : JSON.stringify(variant_axes || []),
        sku || null,
        barcode || null,
        bin || null,
        Boolean(active),
      ]
    );
    return rows[0];
  }

  static async update(id, data) {
    const allowed = ['slug', 'name', 'description', 'name_is', 'description_is', 'price_isk', 'price_eur', 'stock', 'weight_grams', 'shape', 'capacity_litres', 'category', 'subcategory', 'duration_minutes', 'delivery_format', 'is_bookable', 'variant_axes', 'sku', 'barcode', 'bin', 'active'];
    const numeric = new Set(['price_isk', 'price_eur', 'stock', 'weight_grams', 'capacity_litres', 'duration_minutes']);
    const bool    = new Set(['active', 'is_bookable']);
    const jsonField = new Set(['variant_axes']);

    const sets   = [];
    const params = [];

    for (const field of allowed) {
      if (data[field] === undefined) continue;
      let v = data[field];
      // Empty-string → null for numeric fields so callers can clear an
      // optional integer without tripping a CHECK constraint via Number('') = 0.
      if (numeric.has(field)) v = (v === null || v === '') ? null : Number(v);
      if (bool.has(field))    v = Boolean(v);
      // Mirror Project.js: empty-string IS fields clear the translation back
      // to null, which lets COALESCE(name_is, name) fall back to EN on read.
      if ((field === 'name_is' || field === 'description_is') && typeof v === 'string' && v.trim() === '') {
        v = null;
      }
      // Empty SKU / barcode / bin clear back to NULL (keeps the indexes sparse).
      if ((field === 'sku' || field === 'barcode' || field === 'bin') && typeof v === 'string' && v.trim() === '') {
        v = null;
      }
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

  // Bulk fetch across multiple products — avoids N+1 on list endpoints.
  // Caller groups by product_id; ordering preserves per-product position/created_at.
  static async listImagesForProducts(productIds) {
    if (!productIds || productIds.length === 0) return [];
    const { rows } = await db.query(
      `SELECT ${IMG_COLUMNS} FROM product_images
        WHERE product_id = ANY($1::text[])
        ORDER BY product_id, position ASC, created_at ASC`,
      [productIds.map(String)]
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

  // ── CSV export / import ─────────────────────────────────────────────────────

  // One row per sellable unit for the admin catalogue CSV: a row per variant for
  // variant products, else a single product row. Variant money/bin are the
  // variant's OWN values (null = inherits the product), so the export round-trips
  // back through findForImport without flattening inheritance.
  static async listForExport() {
    const { rows } = await db.query(
      `SELECT p.id AS product_id, p.slug, p.name, p.sku AS product_sku, p.barcode,
              p.bin AS product_bin, p.price_isk AS product_price_isk,
              p.price_eur AS product_price_eur, p.stock AS product_stock,
              p.active AS product_active,
              v.id AS variant_id, v.sku AS variant_sku, v.attributes,
              v.bin AS variant_bin, v.price_isk AS variant_price_isk,
              v.price_eur AS variant_price_eur, v.stock AS variant_stock,
              v.active AS variant_active
         FROM products p
         LEFT JOIN product_variants v ON v.product_id = p.id
        ORDER BY lower(p.name), v.sku ASC NULLS FIRST`
    );
    return rows;
  }

  // Resolve a batch of SKUs for import, variant-first (a SKU that matches a
  // variant updates that variant, not the parent product). Returns a Map
  // sku → { kind, productId|variantId, current } where `current` carries the
  // updatable fields so the caller can diff "no change" vs "update".
  static async findForImport(skus) {
    const list = [...new Set((skus || []).map(s => String(s)).filter(Boolean))];
    const bySku = new Map();
    if (!list.length) return bySku;
    const { rows: prows } = await db.query(
      `SELECT id AS product_id, sku, bin, price_isk, price_eur, stock, active
         FROM products WHERE sku = ANY($1::text[])`,
      [list]
    );
    const { rows: vrows } = await db.query(
      `SELECT id AS variant_id, product_id, sku, bin, price_isk, price_eur, stock, active
         FROM product_variants WHERE sku = ANY($1::text[])`,
      [list]
    );
    // Products first, then variants override the same sku (variant precedence).
    for (const r of prows) {
      bySku.set(r.sku, { kind: 'product', productId: r.product_id, current: r });
    }
    for (const r of vrows) {
      bySku.set(r.sku, { kind: 'variant', variantId: r.variant_id, productId: r.product_id, current: r });
    }
    return bySku;
  }
}

module.exports = Product;
