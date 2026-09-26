// Repository pattern for products — all SQL lives here.
// Parameterised queries throughout (A03: prevents SQL injection).
const db = require('../config/database');
const Inventory = require('./Inventory');

// Admin-facing column list: surfaces both locales' raw fields so the CMS
// editor can render EN + IS inputs side-by-side.
const COLUMNS = 'id, slug, name, description, name_is, description_is, price_isk, price_eur, stock, weight_grams, shape, capacity_litres, category, subcategory, duration_minutes, delivery_format, is_bookable, variant_axes, sku, barcode, bin, active, vat_rate, created_at, updated_at';
const IMG_COLUMNS = 'id, product_id, url, position, alt_text, created_at';

// Public-facing column list: COALESCE the IS sibling columns into the primary
// field names so callers see `name` / `description` in the reader's language.
// vat_rate rides along so the cart/checkout can show the VAT inside the total
// per rate (public/js/utils/vat.js; harvest 2 lane 4b, ice #51) — the same
// rate the invoice prints, not an internal figure.
function publicCols(locale) {
  if (locale === 'is') {
    return `id, slug,
            COALESCE(name_is,        name)        AS name,
            COALESCE(description_is, description) AS description,
            price_isk, price_eur, stock, weight_grams, shape, capacity_litres,
            category, subcategory, duration_minutes, delivery_format, is_bookable,
            variant_axes, sku, barcode, bin, active, vat_rate, created_at, updated_at`;
  }
  return 'id, slug, name, description, price_isk, price_eur, stock, weight_grams, shape, capacity_litres, category, subcategory, duration_minutes, delivery_format, is_bookable, variant_axes, sku, barcode, bin, active, vat_rate, created_at, updated_at';
}

class Product {
  // ── READ ──────────────────────────────────────────────────────────────────

  static async findAll({ activeOnly = true, limit = 100, offset = 0, locale = null, category = null } = {}) {
    const cols  = locale ? publicCols(locale) : COLUMNS;
    // Build WHERE incrementally so the `category` filter is optional and the
    // generated SQL is identical to the old shape when it's not used.
    // A merged product (migration 120) is a redirect to its survivor, not a
    // product: never listed, not even to admins.
    const conds  = ['merged_into_id IS NULL'];
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
  // pack_qty/cost_isk columns HalliProjects' schema doesn't have. A variant's
  // own barcode (migration 113) matches at step 1 like its sku; the parent's
  // barcode is the fallback for variants without one.
  static async resolveByCode(code) {
    const c = String(code == null ? '' : code).trim();
    if (!c) return null;

    // 1) A variant whose own sku matches wins (variant precedence).
    const { rows: v } = await db.query(
      `SELECT v.id AS variant_id, v.product_id, p.name, p.slug,
              COALESCE(v.sku, p.sku)             AS sku,
              COALESCE(v.bin, p.bin)             AS bin,
              COALESCE(v.barcode, p.barcode)     AS barcode,
              COALESCE(v.price_isk, p.price_isk) AS price_isk,
              COALESCE(v.price_eur, p.price_eur) AS price_eur,
              v.stock, v.attributes,
              (p.active AND v.active) AS active, p.merged_into_id
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.sku = $1 OR v.barcode = $1
        ORDER BY (v.sku = $1) DESC
        LIMIT 1`,
      [c]
    );
    if (v[0] && v[0].merged_into_id) {
      // A code a product merge retired scans to the live row it went to
      // (migration 120); the target is never itself merged, so this recursion
      // is one step deep.
      const live = await Product._mergedTarget(v[0].variant_id);
      if (live && live.kind === 'variant' && live.current.sku) return Product.resolveByCode(live.current.sku);
      if (live && live.kind === 'product') {
        const { rows: lp } = await db.query(
          `SELECT id AS product_id, slug, name, sku, bin, barcode, price_isk, price_eur, stock, active
             FROM products WHERE id = $1`, [live.productId]);
        if (lp[0]) return Product._scanShape(lp[0], null, null);
      }
    }
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

  // Opening stock is written straight into the INSERT (the creation IS the
  // event) and recorded as an 'opening' inventory_adjustments row in the same
  // transaction, so every unit on the shelf has an audit row. `userId` names
  // the actor.
  static async create(data, { userId = null } = {}) {
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
      // VSK rate charged on this product. 24% is the standard band; 11% is a closed
      // statutory list (books, printed matter, food) — see server/utils/vat.js.
      // Snapshotted onto invoice_lines at issue, so changing it never rewrites a
      // historical invoice.
      vat_rate = 24,
    } = data;
    const client = await db.pool.connect();
    let rows;
    try {
      await client.query('BEGIN');
      ({ rows } = await client.query(
      `INSERT INTO products (slug, name, description, name_is, description_is,
                             price_isk, price_eur, stock, weight_grams, shape, capacity_litres,
                             category, subcategory, duration_minutes, delivery_format, is_bookable,
                             variant_axes, sku, barcode, bin, active, vat_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21, $22)
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
        [0, 11, 24].includes(Number(vat_rate)) ? Number(vat_rate) : 24,
      ]
      ));
      await Inventory.recordOpening(client, { productId: rows[0].id, stock: rows[0].stock, userId });
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
    return rows[0];
  }

  // `stock` is accepted but is NOT a plain column here (harvested from
  // icelandicstore #243/#275): a change moves through Inventory.setAbsolute
  // under the row lock, in the same transaction as the field update, so it is
  // serialised against fulfilment and leaves an inventory_adjustments row naming
  // who moved it and why. `stockReason` / `stockNote` come from the admin form
  // (Inventory.ADJUSTMENT_REASONS; default 'correction').
  static async update(id, data, { userId = null, stockReason = 'correction', stockNote = null } = {}) {
    const allowed = ['slug', 'name', 'description', 'name_is', 'description_is', 'price_isk', 'price_eur', 'weight_grams', 'shape', 'capacity_litres', 'category', 'subcategory', 'duration_minutes', 'delivery_format', 'is_bookable', 'variant_axes', 'sku', 'barcode', 'bin', 'active', 'vat_rate'];
    // No 'stock' here: it is not in `allowed`, so the loop below never sees it.
    const numeric = new Set(['price_isk', 'price_eur', 'weight_grams', 'capacity_litres', 'duration_minutes']);
    const bool    = new Set(['active', 'is_bookable']);
    const jsonField = new Set(['variant_axes']);

    const sets   = [];
    const params = [];

    // VSK rate: validated here rather than left to the CHECK constraint, so a bad
    // value is a clear 400 instead of a raw 23514 from Postgres. The three rates
    // Iceland has are a closed set (server/utils/vat.js) — 11% in particular is a
    // statutory list, not a discretionary discount.
    if (data.vat_rate !== undefined) {
      const rate = Number(data.vat_rate);
      if (!Number.isInteger(rate) || ![0, 11, 24].includes(rate)) {
        const err = new Error('vat_rate must be 0, 11 or 24');
        err.status = 400;
        throw err;
      }
      data = { ...data, vat_rate: rate };
    }

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

    const wantsStock = data.stock !== undefined && data.stock !== null && data.stock !== '';

    if (!wantsStock) {
      if (sets.length === 0) return Product.findById(id);
      params.push(String(id));
      const { rows } = await db.query(
        `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
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

    // Audited path: the field update and the stock move land in one transaction.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock and read under the lock, so the delta is against the value about
      // to be overwritten (applyLines re-locks the same row, which is free).
      const { rows: cur } = await client.query(
        'SELECT stock FROM products WHERE id = $1 FOR UPDATE', [String(id)]
      );
      if (!cur[0]) { await client.query('ROLLBACK'); return null; }
      if (sets.length) {
        params.push(String(id));
        await client.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      }
      await Inventory.setAbsolute(client, {
        productId: String(id), previous: cur[0].stock, target,
        reason: stockReason || 'correction', note: stockNote, userId,
      });
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
    return Product.findById(id);
  }

  // Bulk edit (admin list, multi-select → Edit…): the same scalar fields on many
  // products in ONE statement. `fields` is whitelisted and validated by the
  // controller (BULK_EDIT_FIELDS); stock is never among them. The rows are
  // locked first in the stock lock order (Inventory.lockForWrite), so a
  // multi-row UPDATE in scan order cannot cycle with a fulfilment's sorted
  // locks (ice #380). Returns the affected ids.
  static async bulkEdit(ids, fields) {
    if (!ids || ids.length === 0) return [];
    const cols = ['category', 'subcategory', 'vat_rate', 'active', 'bin'];
    const sets = [];
    const params = [];
    for (const col of cols) {
      if (fields[col] === undefined) continue;
      let v = fields[col];
      if ((col === 'bin' || col === 'subcategory') && typeof v === 'string' && v.trim() === '') v = null;
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
    if (!sets.length) return [];
    params.push(ids.map(String));
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await Inventory.lockForWrite(client, { productIds: ids });
      const { rows } = await client.query(
        `UPDATE products SET ${sets.join(', ')} WHERE id = ANY($${params.length}::text[]) RETURNING id`,
        params
      );
      await client.query('COMMIT');
      return rows.map(r => r.id);
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  static async deactivate(id) {
    return Product.update(id, { active: false });
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
      `SELECT p.id AS product_id, p.slug, p.name, p.sku AS product_sku,
              COALESCE(v.barcode, p.barcode) AS barcode, p.variant_axes,
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
      `SELECT v.id AS variant_id, v.product_id, v.sku, v.bin, v.price_isk, v.price_eur, v.stock, v.active,
              p.merged_into_id
         FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.sku = ANY($1::text[])`,
      [list]
    );
    // Products first, then variants override the same sku (variant precedence).
    for (const r of prows) {
      bySku.set(r.sku, { kind: 'product', productId: r.product_id, current: r });
    }
    for (const r of vrows) {
      // A SKU a product merge retired (it stays on the switched-off row under
      // the merged product) updates the LIVE row it went to, never the hidden
      // one; one that resolves nowhere matches nothing (migration 120).
      const live = r.merged_into_id ? await Product._mergedTarget(r.variant_id) : null;
      if (r.merged_into_id && !live) { bySku.delete(r.sku); continue; }
      bySku.set(r.sku, live || { kind: 'variant', variantId: r.variant_id, productId: r.product_id, current: r });
    }
    return bySku;
  }

  // Where a variant of a MERGED product lives now, in findForImport's entry
  // shape ({ kind, productId, variantId?, current }), or null.
  static async _mergedTarget(variantId) {
    const ProductMerge = require('./ProductMerge');
    const live = await ProductMerge.resolveLive({ variantId });
    if (!live) return null;
    if (live.variantId) {
      const { rows } = await db.query(
        `SELECT id AS variant_id, product_id, sku, bin, price_isk, price_eur, stock, active
           FROM product_variants WHERE id = $1`, [live.variantId]);
      return rows[0] ? { kind: 'variant', variantId: rows[0].variant_id, productId: rows[0].product_id, current: rows[0] } : null;
    }
    // Product level only for a product without variants: a switched-off row
    // that was not part of the merge must not start writing the survivor's
    // product-level stock.
    const { rows } = await db.query(
      `SELECT id AS product_id, sku, bin, price_isk, price_eur, stock, active FROM products
        WHERE id = $1 AND variant_axes = '[]'::jsonb
          AND NOT EXISTS (SELECT 1 FROM product_variants WHERE product_id = $1)`, [live.productId]);
    return rows[0] ? { kind: 'product', productId: rows[0].product_id, current: rows[0] } : null;
  }

  // The survivor a product was merged into (migration 120), or null.
  static async mergedInto(id) {
    const { rows } = await db.query('SELECT merged_into_id FROM products WHERE id = $1', [String(id)]);
    return rows[0] && rows[0].merged_into_id ? rows[0].merged_into_id : null;
  }

  // Resolve a batch of BARCODES for import — the FALLBACK match key when a row's
  // SKU matches nothing (a supplier's sheet carries our GTIN and their article
  // number; harvested from icelandicstore #249). A barcode on more than one row
  // (products and variants together) is returned as { ambiguous: true } and the
  // import refuses it, never guesses. A variant product's own barcode is not a
  // match target (its sellable rows are the variants).
  static async findForImportByBarcode(barcodes) {
    const list = [...new Set((barcodes || []).map(s => String(s)).filter(Boolean))];
    const byCode = new Map();
    if (!list.length) return byCode;
    const { rows: prows } = await db.query(
      `SELECT id AS product_id, sku, barcode, bin, price_isk, price_eur, stock, active
         FROM products
        WHERE barcode = ANY($1::text[]) AND variant_axes = '[]'::jsonb`,
      [list]
    );
    const { rows: vrows } = await db.query(
      `SELECT id AS variant_id, product_id, sku, barcode, bin, price_isk, price_eur, stock, active
         FROM product_variants WHERE barcode = ANY($1::text[])`,
      [list]
    );
    const hits = new Map();
    for (const r of prows) {
      (hits.get(r.barcode) || hits.set(r.barcode, []).get(r.barcode))
        .push({ kind: 'product', productId: r.product_id, current: r });
    }
    for (const r of vrows) {
      (hits.get(r.barcode) || hits.set(r.barcode, []).get(r.barcode))
        .push({ kind: 'variant', variantId: r.variant_id, productId: r.product_id, current: r });
    }
    for (const [code, entries] of hits) byCode.set(code, entries.length === 1 ? entries[0] : { ambiguous: true });
    return byCode;
  }

  // Create-from-import checks: which of these slugs / lower-cased names already
  // name a product, and which of these barcodes are already on a row.
  static async findExistingForGroups({ slugs = [], names = [] } = {}) {
    const { rows } = await db.query(
      `SELECT slug, lower(name) AS lname FROM products
        WHERE slug = ANY($1::text[]) OR lower(name) = ANY($2::text[])`,
      [slugs.map(String), names.map(n => String(n).toLowerCase())]
    );
    return { slugs: new Set(rows.map(r => r.slug)), names: new Set(rows.map(r => r.lname)) };
  }

  static async findBarcodesInUse(barcodes) {
    const list = [...new Set((barcodes || []).map(String).filter(Boolean))];
    if (!list.length) return [];
    const { rows } = await db.query(
      `SELECT barcode FROM products WHERE barcode = ANY($1::text[])
       UNION SELECT barcode FROM product_variants WHERE barcode = ANY($1::text[])`,
      [list]
    );
    return rows.map(r => r.barcode);
  }

  // Every slug starting with `base` — so a generated slug can take the next free
  // suffix without one round-trip per candidate.
  static async slugsLike(base) {
    const { rows } = await db.query(
      `SELECT slug FROM products WHERE slug = $1 OR slug LIKE $2`,
      [String(base), `${String(base).replace(/[\\%_]/g, '\\$&')}-%`]
    );
    return rows.map(r => r.slug);
  }

  // One new product with its variants, created WHOLE or not at all (the
  // variant-creating import, ice #302): the product row, every variant with its
  // opening stock audited ('opening', note 'import'), in one transaction, with
  // the variants' foreign keys taken after the parent exists. A variant price
  // equal to the parent's is stored as NULL (inherits), the way the admin
  // grid stores it. Returns { product, variants }.
  static async createWithVariants(parent, variants, { userId = null } = {}) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: prow } = await client.query(
        `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, category,
                               variant_axes, active, vat_rate)
         VALUES ($1, $2, '', $3, $4, 0, 'product', $5::jsonb, $6, 24)
         RETURNING ${COLUMNS}`,
        [String(parent.slug), String(parent.name), Number(parent.price_isk), Number(parent.price_eur),
         JSON.stringify(parent.axes || []), Boolean(parent.active)]
      );
      const product = prow[0];
      const created = [];
      for (const v of variants) {
        const own = (field) => (v[field] == null || Number(v[field]) === Number(product[field]) ? null : Number(v[field]));
        const { rows: vrow } = await client.query(
          `INSERT INTO product_variants (product_id, sku, attributes, price_isk, price_eur, stock, bin, barcode, active)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
           RETURNING id, product_id, sku, stock`,
          [product.id, String(v.sku), JSON.stringify(v.attributes), own('price_isk'), own('price_eur'),
           Math.max(0, Math.trunc(Number(v.stock) || 0)), v.bin || null, v.barcode || null, v.active !== false]
        );
        await Inventory.recordOpening(client, {
          productId: product.id, variantId: vrow[0].id, stock: vrow[0].stock, userId, note: 'import',
        });
        created.push(vrow[0]);
      }
      await client.query('COMMIT');
      return { product, variants: created };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = Product;
