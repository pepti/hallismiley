'use strict';
// Add variants to a product that ALREADY EXISTS — the one writer behind the
// admin bulk route (POST /admin/shop/products/:id/variants/bulk) and the MCP
// `add_variants` tool. Ported from icelandicstore #432 (ice@d13c6553; harvest
// 2 lane 6c, 2026-09-26).
//
// Why a second path next to the one-variant POST: a new colour of a garment is
// six rows (XS–2XL), each with its own SKU and barcode. Six separate POSTs can
// leave three sizes behind when the fourth collides — a half-created colour
// looks finished and is not. So a batch is checked whole and written whole,
// like Product.createWithVariants does for a new product.
//
// What it checks, before writing anything:
//   • the product exists and HAS variant axes — adding the first variants to a
//     single-SKU product would move its stock semantics (products.stock →
//     per-variant) and is not what this is for
//   • every row names every axis of the product and nothing else; axis names
//     are compared case-blind and written in the spelling the product already
//     uses, because uniq_product_variants_attrs_live compares the jsonb exactly
//     ({"Color":…} and {"color":…} are two different rows to Postgres)
//   • no row repeats a value combination the product already has (folded the
//     way variantAxis folds: "Black (BL)" = "black") or another row's
//   • SKU on every row; SKUs and barcodes unique in the batch and unused in the
//     live catalogue — as a SKU OR a barcode, compared case-blind, because
//     Product.resolveByCode answers to either column and one code must name
//     one thing (the scanner, the import)
//
// Engine deltas from ice: no product merges (the merged-product refusal and
// merged-SKU check are not taken — lane 6b brings merges; add them there);
// an ARCHIVED variant's SKU is free here (migration 119 makes archiving free
// the SKU for the one-variant route too — one rule for both paths); prices
// are the engine's VAT-inclusive price_isk / price_eur overrides; the shelf is
// written on the variant row (the engine has no bin-move audit table).
//
// Stock is always 0: opening stock arrives through a count, receiving or
// set_stock — each an audited movement through models/Inventory.js. Nothing
// here writes stock.
//
// Errors are returned, not thrown, as { index, field, reason, value } so the
// admin UI can mark the row and MCP can list every problem in one answer.
const db = require('../config/database');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const { axisKey, valueKeyFor } = require('../utils/variantAxis');
const logger = require('../logger');
const { t } = require('../i18n');

const MAX_ROWS = 200;
const MAX_SKU_LEN = 100;
const MAX_BARCODE_LEN = 64;
const MAX_BIN_LEN = 40;
const MAX_ATTR_VAL_LEN = 100;
const MAX_PRICE = 100000000;
// Any Unicode control character. A NUL is refused by Postgres in text (22021)
// and jsonb (22P05) — a 500, not an answer — and the others are never meant.
const CONTROL = /\p{Cc}/u;

const lower = (v) => (v == null ? '' : String(v)).trim().toLowerCase();

// A SKU / barcode cell: text, or a plain number (a spreadsheet cell of digits
// arrives as one). Anything else is refused rather than stringified into
// "[object Object]". → { value } | { bad: reason }
function codeCell(v, max) {
  if (v === undefined || v === null) return { value: '' };
  if (typeof v === 'number' && Number.isFinite(v)) return { value: String(v) };
  if (typeof v !== 'string') return { bad: 'bad_type' };
  const s = v.trim();
  if (CONTROL.test(s)) return { bad: 'bad_chars' };
  if (s.length > max) return { bad: 'too_long' };
  return { value: s };
}

// A whole-krónur / whole-cent price override: an integer, or a string of
// digits from a form. Absent = inherit the product's price.
function priceCell(p) {
  if (p === undefined || p === null || p === '') return { value: null };
  const n = typeof p === 'number' ? p : (typeof p === 'string' && /^\d+$/.test(p.trim()) ? Number(p) : NaN);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PRICE) return { bad: true };
  return { value: n };
}

// The axis spelling to write. A product's live variants are what the unique
// index compares against, so their keys win; the product's variant_axes are
// the fallback for a product with no variants yet.
function axisSpelling(product, existing) {
  const axes = Array.isArray(product.variant_axes) ? product.variant_axes.map(String) : [];
  const spelled = new Map(axes.map((a) => [axisKey(a), a]));
  for (const v of existing) {
    for (const k of Object.keys(v.attributes || {})) {
      if (spelled.has(axisKey(k))) spelled.set(axisKey(k), k);
    }
  }
  return axes.map((a) => spelled.get(axisKey(a)));
}

const SEP = String.fromCharCode(1); // cannot occur in a value: CONTROL refuses it
function comboKey(axes, attributes) {
  return axes.map((a) => valueKeyFor(a, attributes[a])).join(SEP);
}

// Pure: no I/O. `existing` = the product's live variants. Returns
// { axes, rows, errors } — rows normalised (attributes keyed in the product's
// spelling, trimmed strings), errors per row.
function planVariants(product, existing, input, { active = true } = {}) {
  const errors = [];
  const push = (index, field, reason, value) => errors.push({ index, field, reason, ...(value !== undefined ? { value } : {}) });
  const axes = axisSpelling(product, existing || []);

  if (!Array.isArray(input) || input.length === 0) {
    errors.push({ index: null, field: 'variants', reason: 'empty' });
    return { axes, rows: [], errors };
  }
  if (input.length > MAX_ROWS) {
    errors.push({ index: null, field: 'variants', reason: 'too_many', value: MAX_ROWS });
    return { axes, rows: [], errors };
  }
  if (axes.length === 0) {
    errors.push({ index: null, field: 'variants', reason: 'no_axes' });
    return { axes, rows: [], errors };
  }

  const taken = new Set((existing || []).map((v) => {
    const a = {};
    for (const axis of axes) {
      const hit = Object.keys(v.attributes || {}).find((k) => axisKey(k) === axisKey(axis));
      a[axis] = hit === undefined ? '' : v.attributes[hit];
    }
    return comboKey(axes, a);
  }));
  const seenCombo = new Map(); const seenSku = new Map(); const seenBarcode = new Map();
  const rows = [];

  input.forEach((raw, i) => {
    const before = errors.length;
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const src = r.attributes && typeof r.attributes === 'object' && !Array.isArray(r.attributes) ? r.attributes : null;

    const attributes = {};
    if (!src) {
      push(i, 'attributes', 'attributes_required');
    } else {
      const named = new Set(); // axes this row mentions, well-formed or not
      for (const [k, v] of Object.entries(src)) {
        const axis = axes.find((a) => axisKey(a) === axisKey(k));
        if (!axis) { push(i, 'attributes', 'unknown_axis', k); continue; }
        if (named.has(axis)) { push(i, 'attributes', 'duplicate_axis', k); continue; }
        named.add(axis);
        const val = typeof v === 'string' ? v.trim() : '';
        if (!val || val.length > MAX_ATTR_VAL_LEN || CONTROL.test(val)) { push(i, 'attributes', 'bad_value', k); continue; }
        attributes[axis] = val;
      }
      for (const a of axes) if (!named.has(a)) push(i, 'attributes', 'missing_axis', a);
    }

    const skuCell = codeCell(r.sku, MAX_SKU_LEN);
    const sku = skuCell.value || '';
    if (skuCell.bad) push(i, 'sku', skuCell.bad, skuCell.bad === 'too_long' ? MAX_SKU_LEN : undefined);
    else if (!sku) push(i, 'sku', 'sku_required');

    const barcodeCell = codeCell(r.barcode, MAX_BARCODE_LEN);
    const barcode = barcodeCell.value || '';
    if (barcodeCell.bad) push(i, 'barcode', barcodeCell.bad, barcodeCell.bad === 'too_long' ? MAX_BARCODE_LEN : undefined);

    const priceIsk = priceCell(r.price_isk);
    if (priceIsk.bad) push(i, 'price_isk', 'bad_price');
    const priceEur = priceCell(r.price_eur);
    if (priceEur.bad) push(i, 'price_eur', 'bad_price');

    let bin = null;
    if (r.bin !== undefined && r.bin !== null && r.bin !== '') {
      const b = typeof r.bin === 'string' ? r.bin.trim() : '';
      if (!b || b.length > MAX_BIN_LEN || CONTROL.test(b)) push(i, 'bin', 'bad_bin');
      else bin = b;
    }

    if (errors.length === before) {
      const key = comboKey(axes, attributes);
      const label = axes.map((a) => attributes[a]).join(' / ');
      if (taken.has(key)) push(i, 'attributes', 'exists', label);
      else if (seenCombo.has(key)) push(i, 'attributes', 'duplicate_in_batch', label);
      else seenCombo.set(key, i);
    }
    if (sku) {
      if (seenSku.has(lower(sku)) || seenBarcode.has(lower(sku))) push(i, 'sku', 'duplicate_in_batch', sku);
      seenSku.set(lower(sku), i);
    }
    if (barcode) {
      if (seenBarcode.has(lower(barcode)) || (seenSku.has(lower(barcode)) && lower(barcode) !== lower(sku))) push(i, 'barcode', 'duplicate_in_batch', barcode);
      seenBarcode.set(lower(barcode), i);
    }
    rows.push({
      attributes, sku, barcode: barcode || null,
      price_isk: priceIsk.value ?? null, price_eur: priceEur.value ?? null, bin, active,
    });
  });

  return { axes, rows, errors };
}

// Codes already answering for something in the LIVE catalogue, as a SKU or a
// barcode, compared case-blind (stricter than the unique SKU index, which is
// case-sensitive). Archived variants do not count (see the header). Barcodes
// have no unique index at all (migration 113), so this check is their only
// guard — which is why addVariants re-runs it under a lock in the transaction.
async function catalogueConflicts(q, rows) {
  const want = [...new Set(rows.flatMap((r) => [r.sku, r.barcode]).map(lower).filter(Boolean))];
  if (!want.length) return [];
  const { rows: hits } = await q.query(
    `SELECT lower(sku) AS c FROM products WHERE lower(sku) = ANY($1::text[])
      UNION SELECT lower(barcode) FROM products WHERE lower(barcode) = ANY($1::text[])
      UNION SELECT lower(sku) FROM product_variants WHERE lower(sku) = ANY($1::text[]) AND archived_at IS NULL
      UNION SELECT lower(barcode) FROM product_variants WHERE lower(barcode) = ANY($1::text[]) AND archived_at IS NULL`,
    [want]
  );
  const inUse = new Set(hits.map((h) => h.c));
  const errors = [];
  rows.forEach((r, i) => {
    if (r.sku && inUse.has(lower(r.sku))) errors.push({ index: i, field: 'sku', reason: 'sku_taken', value: r.sku });
    if (r.barcode && inUse.has(lower(r.barcode))) errors.push({ index: i, field: 'barcode', reason: 'barcode_taken', value: r.barcode });
  });
  return errors;
}

// Plan + catalogue check against `q` (the pool, or a client inside the write
// transaction). Both kinds of problem come back in ONE answer. 400 when the
// list itself is wrong, 409 when it is fine but collides.
async function evaluate(q, product, input, active) {
  const { rows: existing } = await q.query(
    'SELECT attributes FROM product_variants WHERE product_id = $1 AND archived_at IS NULL', [product.id]);
  const plan = planVariants(product, existing, input, { active });
  const conflicts = await catalogueConflicts(q, plan.rows);
  if (!plan.errors.length && !conflicts.length) return { plan };
  const errors = [...plan.errors, ...conflicts]
    .sort((a, b) => (a.index == null ? -1 : a.index) - (b.index == null ? -1 : b.index));
  return { plan, status: plan.errors.length ? 400 : 409, errors };
}

// The whole operation. Returns
//   { ok: false, status, reason?, errors?, product? }  — nothing written
//   { ok: true, dryRun, product, axes, variants }      — written (or would be)
// `active` = the active flag of every created variant (MCP passes false: what
// Claude adds stays off the storefront until a person switches it on).
async function addVariants(productId, input, { userId = null, source = 'admin', active = true, dryRun = false } = {}) {
  const product = await Product.findById(String(productId));
  if (!product) return { ok: false, status: 404, reason: 'not_found' };

  const first = await evaluate(db, product, input, active);
  if (first.errors) return { ok: false, status: first.status, errors: first.errors, product };
  if (dryRun) return { ok: true, dryRun: true, product, axes: first.plan.axes, variants: first.plan.rows };

  // Serialise writers that could collide, then check again under the locks:
  // one advisory lock per product and per lower-cased code, taken in sorted
  // order so two batches sharing codes queue instead of deadlocking. The
  // product row is read FOR KEY SHARE (the lock the variant inserts' foreign
  // key takes anyway — the engine lock order in models/Inventory.js); no
  // variant row another path holds is locked here.
  const keys = [...new Set([
    `variant-add:product:${product.id}`,
    ...first.plan.rows.flatMap((r) => [r.sku, r.barcode]).filter(Boolean).map((c) => `variant-add:code:${lower(c)}`),
  ])].sort();

  const client = await db.pool.connect();
  let released = false;
  const created = [];
  try {
    await client.query('BEGIN');
    for (const k of keys) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [k]);
    const { rows: [fresh] } = await client.query(
      'SELECT variant_axes FROM products WHERE id = $1 FOR KEY SHARE', [product.id]);
    if (!fresh) { await client.query('ROLLBACK'); return { ok: false, status: 404, reason: 'not_found' }; }
    const again = await evaluate(client, { ...product, variant_axes: fresh.variant_axes }, input, active);
    if (again.errors) {
      await client.query('ROLLBACK');
      return { ok: false, status: again.status, errors: again.errors, product };
    }
    for (const r of again.plan.rows) {
      created.push(await ProductVariant.create({
        product_id: product.id, sku: r.sku, attributes: r.attributes,
        price_isk: r.price_isk, price_eur: r.price_eur, barcode: r.barcode, bin: r.bin,
        active: r.active, stock: 0,
      }, { userId, client }));
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // A connection that cannot roll back is not handed back to the pool.
      client.release(rollbackErr);
      released = true;
    }
    // Backstop: the exact-SKU unique index still fires if a writer that takes
    // none of these locks (the one-variant route) got there first.
    if (err.code === '23505') return { ok: false, status: 409, reason: 'conflict', product };
    throw err;
  } finally {
    if (!released) client.release();
  }
  logger.info({ productId: product.id, count: created.length, source, userId }, 'variants.added');
  return { ok: true, dryRun: false, product, axes: first.plan.axes, variants: created };
}

// One sentence per problem, in the reader's language. Rows are numbered from 1
// the way a person counts the lines they pasted.
function describe(errors, locale, axes = []) {
  return (errors || []).map((e) => ({
    ...e,
    message: t(locale, `errors.variantAdd.${e.reason}`, {
      row: e.index == null ? '' : e.index + 1,
      value: e.value == null ? '' : e.value,
      field: e.field,
      n: MAX_ROWS,
      axes: axes.join(', '),
    }),
  }));
}

module.exports = { addVariants, planVariants, describe, MAX_ROWS };
