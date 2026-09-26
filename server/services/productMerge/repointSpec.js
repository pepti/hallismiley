'use strict';

// What a product merge does to every row that points at a product or a variant.
// Ported from icelandicstore #311 (server/services/productMerge/repointSpec.js),
// cut to the engine's foreign keys: 11 at migration 120 — 9 → products (the
// merge's own three included) and 2 → product_variants.
//
// Keyed by table, one entry per (product column, variant column) pair, and it
// must name EVERY foreign key to products / product_variants that pg_constraint
// knows about. assertCovers() checks that at runtime before any merge writes,
// and tests/integration/productMerge.test.js checks it in CI, in both
// directions: a migration that adds a product FK without deciding what a merge
// does with it (a goods-receipt line, a delivery-note line …) stops merges cold
// (SCHEMA_DRIFT) rather than leaving rows behind on an inactive product.
//
// Policies:
//   repoint        — rows follow the unit they belong to (engine.repoint):
//                    order lines, so Committed stock and a later un-fulfil
//                    follow the stock onto the survivor. Order lines carry
//                    their own name/price/attribute snapshots, so what an
//                    order SAYS never changes.
//   repoint_draft  — invoice lines: only on DRAFT invoices. An issued invoice
//                    is part of the books and never changes (bókhaldslög); its
//                    product link keeps the merged row, which is why that row
//                    is never deleted.
//   dedupe         — the primary key includes the product (collection links):
//                    a row that would collide with the master's is dropped, the
//                    rest follow.
//   images         — the merged product's images move to the survivor, after
//                    its own (positions shifted); a URL the survivor already
//                    shows is not added twice (engine choice — ice keeps them
//                    on the merged row, see the history fragment).
//   stay           — audit history: inventory_adjustments keep the product
//                    they happened on; the merge log itself.
//   variants       — product_variants.product_id: handled explicitly (moved
//                    rows change parent, mapped rows are switched off in place).
//   flatten        — products.merged_into_id: products merged earlier INTO a
//                    source now point at the master (no redirect chains).
const SPEC = [
  { table: 'order_items',           product: 'product_id',     variant: 'product_variant_id', policy: 'repoint' },
  { table: 'invoice_lines',         product: 'product_id',     variant: null,                 policy: 'repoint_draft' },
  { table: 'product_collections',   product: 'product_id',     variant: null, policy: 'dedupe', key: ['collection_id'] },
  { table: 'product_images',        product: 'product_id',     variant: null,                 policy: 'images' },
  { table: 'inventory_adjustments', product: 'product_id',     variant: 'product_variant_id', policy: 'stay' },
  { table: 'product_merges',        product: 'master_id',      variant: null,                 policy: 'stay' },
  { table: 'product_merges',        product: 'merged_id',      variant: null,                 policy: 'stay' },
  { table: 'product_variants',      product: 'product_id',     variant: null,                 policy: 'variants' },
  { table: 'products',              product: 'merged_into_id', variant: null,                 policy: 'flatten' },
];

// "table.column" for every FK column the spec accounts for, by target.
function coveredColumns() {
  const products = new Set();
  const variants = new Set();
  for (const e of SPEC) {
    products.add(`${e.table}.${e.product}`);
    if (e.variant) variants.add(`${e.table}.${e.variant}`);
  }
  return { products, variants };
}

// fks: rows of { target: 'products'|'product_variants', tbl, col } from
// pg_constraint. → { missing: [...], stale: [...] } ("table.column → target").
function coverage(fks) {
  const { products, variants } = coveredColumns();
  const seen = { products: new Set(), variants: new Set() };
  const missing = [];
  for (const fk of fks) {
    const key = `${fk.tbl}.${fk.col}`;
    const bucket = fk.target === 'products' ? 'products' : 'variants';
    seen[bucket].add(key);
    if (!(bucket === 'products' ? products : variants).has(key)) missing.push(`${key} → ${fk.target}`);
  }
  const stale = [
    ...[...products].filter(k => !seen.products.has(k)).map(k => `${k} → products`),
    ...[...variants].filter(k => !seen.variants.has(k)).map(k => `${k} → product_variants`),
  ];
  return { missing, stale };
}

function assertCovers(fks) {
  const { missing } = coverage(fks);
  if (missing.length) {
    const e = new Error(`product merge: no policy for foreign key(s) ${missing.join(', ')}`);
    e.code = 'SCHEMA_DRIFT';
    e.missing = missing;
    throw e;
  }
}

module.exports = { SPEC, coverage, assertCovers };
