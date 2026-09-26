'use strict';

// ProductMerge — duplicate products: the read side of Products → Duplicates and
// the lookups that make a merged product answer as its survivor. Ported from
// icelandicstore #309/#311/#312 (server/models/ProductMerge.js), cut to the
// engine's columns (no vendor / internal / archived_at: an engine variant is
// "archived" when it is switched off). The merge itself is
// services/productMerge/engine.js; nothing here writes.
const db = require('../config/database');
const { findDuplicateGroups, SIGNAL_RANK } = require('../utils/productDedupe');

// Every foreign key pointing at products / product_variants, read from the
// catalog rather than hard-coded: a new table with a product FK is counted the
// day its migration lands, and the merge engine refuses to run until
// repointSpec names a policy for it. 15 at migration 120.
let fkCache = null;
async function productForeignKeys() {
  if (fkCache) return fkCache;
  const { rows } = await db.query(
    `SELECT c.confrelid::regclass::text AS target, c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN unnest(c.conkey) k(attnum) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f'
        AND c.confrelid IN ('products'::regclass, 'product_variants'::regclass)
      ORDER BY 1, 2, 3`
  );
  fkCache = rows;
  return rows;
}

// A product's own children are its shape, not history pointing at it.
const OWN_CHILDREN = new Set(['product_variants', 'product_images']);
const IDENT = /^[a-z_][a-z0-9_]*$/;

// → Map productId → { order_lines, references, tables: { tbl: n } }
async function referenceCounts(productIds, variantOwner) {
  const counts = new Map(productIds.map(id => [id, { order_lines: 0, references: 0, tables: {} }]));
  if (!productIds.length) return counts;
  const variantIds = [...variantOwner.keys()];
  for (const fk of await productForeignKeys()) {
    if (OWN_CHILDREN.has(fk.tbl)) continue;
    // Names come from pg_catalog, never from a request — the check is belt and braces.
    if (!IDENT.test(fk.tbl) || !IDENT.test(fk.col)) continue;
    const ids = fk.target === 'products' ? productIds : variantIds;
    if (!ids.length) continue;
    const { rows } = await db.query(
      `SELECT ${fk.col}::text AS id, COUNT(*)::int AS n FROM ${fk.tbl} WHERE ${fk.col}::text = ANY($1::text[]) GROUP BY 1`,
      [ids]
    );
    for (const r of rows) {
      const pid = fk.target === 'products' ? r.id : variantOwner.get(r.id);
      const c = counts.get(pid);
      if (!c) continue;
      c.references += r.n;
      c.tables[fk.tbl] = (c.tables[fk.tbl] || 0) + r.n;
      // Order lines counted once per line: a variant line also carries product_id.
      if (fk.tbl === 'order_items' && fk.target === 'products') c.order_lines += r.n;
    }
  }
  return counts;
}

class ProductMerge {
  // The Duplicates screen: every suggested group with the evidence (the
  // signals) and what an admin needs before deciding — live and switched-off
  // variant counts, on hand, order lines, images, collection links and how
  // much other history hangs off each product. A suggestion is never an
  // authorisation: the merge re-checks everything under locks.
  static async findDuplicateGroups() {
    const { rows: products } = await db.query(
      `SELECT p.id::text AS id, p.slug, p.name, p.sku, p.barcode, p.category, p.is_bookable,
              p.active, p.variant_axes, p.stock, p.created_at,
              (SELECT COUNT(*)::int FROM product_images i WHERE i.product_id = p.id) AS image_count
         FROM products p
        -- A merged product is a redirect now, not a duplicate to suggest.
        WHERE p.merged_into_id IS NULL`
    );
    const { rows: variants } = await db.query(
      `SELECT v.id::text AS id, v.product_id::text AS product_id, v.sku, v.barcode, v.attributes, v.active, v.stock
         FROM product_variants v`
    );
    const byProduct = new Map(products.map(p => [p.id, { ...p, variants: [] }]));
    for (const v of variants) {
      const p = byProduct.get(v.product_id);
      if (p) p.variants.push(v);
    }

    const groups = findDuplicateGroups([...byProduct.values()]);
    if (!groups.length) return [];

    const groupedIds = [...new Set(groups.flatMap(g => g.products.map(p => p.id)))];
    const variantOwner = new Map();
    for (const id of groupedIds) for (const v of byProduct.get(id).variants) variantOwner.set(v.id, id);
    const refs = await referenceCounts(groupedIds, variantOwner);

    const decorated = groups.map((g) => {
      const list = g.products.map((gp) => {
        const p = byProduct.get(gp.id);
        const live = p.variants.filter(v => v.active !== false);
        const r = refs.get(gp.id);
        return {
          ...gp,
          slug: p.slug,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          category: p.category,
          active: p.active,
          variant_axes: p.variant_axes || [],
          variant_count: live.length,
          inactive_variant_count: p.variants.length - live.length,
          on_hand: live.length ? live.reduce((s, v) => s + (Number(v.stock) || 0), 0) : Number(p.stock) || 0,
          image_count: Number(p.image_count) || 0,
          collection_count: r.tables.product_collections || 0,
          order_lines: r.order_lines,
          references: r.references,
          created_at: p.created_at,
        };
      });
      // Without a colourway master, suggest the product a merge would most
      // likely keep: sellable over draft, then the most order history, then the
      // most variants, then the oldest row.
      let masterId = g.masterId;
      if (!masterId) {
        masterId = list.slice().sort((a, b) =>
          (Number(b.active) - Number(a.active))
          || (b.order_lines - a.order_lines)
          || (b.variant_count - a.variant_count)
          || (new Date(a.created_at) - new Date(b.created_at)))[0].id;
      }
      list.sort((a, b) => (Number(b.id === masterId) - Number(a.id === masterId)) || a.name.localeCompare(b.name, 'is'));
      return { ...g, masterId, products: list };
    });

    decorated.sort((a, b) => (SIGNAL_RANK[b.type] - SIGNAL_RANK[a.type])
      || a.products[0].name.localeCompare(b.products[0].name, 'is'));
    return decorated;
  }

  // Where a merged product's URL should go (the public product page and the
  // shop API). Follows merged_into_id up to five hops; null unless the final
  // product is live, and never when a LIVE product owns the slug (the caller
  // only asks after the live lookup missed).
  static async movedTo(slug) {
    const s = String(slug == null ? '' : slug).trim();
    if (!s) return null;
    const { rows } = await db.query(`SELECT id, slug, merged_into_id, active FROM products WHERE slug = $1`, [s]);
    const start = rows[0];
    if (!start || !start.merged_into_id) return null;
    let id = start.merged_into_id;
    for (let hop = 0; hop < 5 && id; hop += 1) {
      const { rows: r } = await db.query(`SELECT id, slug, merged_into_id, active FROM products WHERE id = $1`, [id]);
      const p = r[0];
      if (!p) return null;
      if (!p.merged_into_id) return p.active ? { id: p.id, slug: p.slug } : null;
      id = p.merged_into_id;
    }
    return null;
  }

  // Where a (product, variant) that may have been merged away lives NOW,
  // through chains (A→B, then B→C): the log rows keep the master of THEIR day,
  // so the walk re-reads the live rows at every step. → { productId,
  // variantId|null, redirected } or null (no such row, or a variant switched
  // off by something other than a merge — the caller keeps its old behaviour).
  // Used by the import's SKU/barcode match and the scanner, so a retired code
  // lands on the live row it went to instead of a hidden one.
  static async resolveLive({ productId = null, variantId = null }, q = (t, p) => db.query(t, p)) {
    let pid = productId ? String(productId) : null;
    let vid = variantId ? String(variantId) : null;
    let redirected = false;
    for (let hop = 0; hop < 10; hop += 1) {
      if (vid) {
        const { rows } = await q(
          `SELECT v.id, v.product_id, v.active, p.merged_into_id
             FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`, [vid]);
        const v = rows[0];
        if (!v) return null;
        if (v.active && !v.merged_into_id) return { productId: v.product_id, variantId: v.id, redirected };
        const { rows: hit } = await q(
          `SELECT m.master_id, e->>'target_variant_id' AS target_variant_id
             FROM product_merges m, jsonb_array_elements(m.variant_map) e
            WHERE e->>'source_variant_id' = $1
            ORDER BY m.merged_at DESC LIMIT 1`, [vid]);
        if (!hit[0]) {
          if (!v.merged_into_id) return null;
          redirected = true; pid = v.merged_into_id; vid = null;
          continue;
        }
        redirected = true;
        vid = hit[0].target_variant_id || null;
        pid = hit[0].master_id;
        continue;
      }
      if (!pid) return null;
      const { rows } = await q(`SELECT id, merged_into_id FROM products WHERE id = $1`, [pid]);
      const p = rows[0];
      if (!p) return null;
      if (!p.merged_into_id) return { productId: p.id, variantId: null, redirected };
      // A simple product mapped onto a master VARIANT lands on that variant.
      const { rows: hit } = await q(
        `SELECT e->>'target_variant_id' AS target_variant_id
           FROM product_merges m, jsonb_array_elements(m.variant_map) e
          WHERE e->>'source_product_id' = $1 AND e->>'source_variant_id' IS NULL
          ORDER BY m.merged_at DESC LIMIT 1`, [p.id]);
      redirected = true;
      if (hit[0] && hit[0].target_variant_id) { vid = hit[0].target_variant_id; pid = null; }
      else pid = p.merged_into_id;
    }
    return null;
  }

  // The merge log of one product (as master or as merged), newest first — for
  // the Duplicates screen's "done" line and the audit trail.
  static async logFor(productId, { limit = 20 } = {}) {
    const { rows } = await db.query(
      `SELECT m.id, m.master_id, m.merged_id, m.shape, m.merged_name, m.merged_slug, m.stock_moved,
              m.counts, m.warnings, m.ms, m.merged_at, u.username AS merged_by_name
         FROM product_merges m LEFT JOIN users u ON u.id = m.merged_by
        WHERE m.master_id = $1 OR m.merged_id = $1
        ORDER BY m.merged_at DESC LIMIT $2`,
      [String(productId), Math.min(100, Math.max(1, Number(limit) || 20))]
    );
    return rows;
  }
}

ProductMerge._resetFkCache = () => { fkCache = null; };
ProductMerge.productForeignKeys = productForeignKeys;

module.exports = ProductMerge;
