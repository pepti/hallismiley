'use strict';

// Product merge ENGINE. Ported from icelandicstore #311/#315
// (server/services/productMerge/engine.js), cut to the engine's catalogue (see
// planner.js for what was left behind). Loads the rows, runs the pure planner,
// and — for apply — does everything in ONE transaction:
//
//   1. SET LOCAL lock_timeout (a busy row → 55P03 → MERGE_BUSY, never a hang)
//   2. locks, in the stock module's lock order (models/Inventory.js):
//        every order that references an involved product, FOR UPDATE by id —
//          first, because a fulfilment locks the order before its lines' rows;
//        involved products that HAVE variants (parents), FOR UPDATE, sorted;
//        their variants, FOR UPDATE, sorted;
//        involved products without variants, FOR UPDATE, sorted.
//      FOR UPDATE (not NO KEY UPDATE) on purpose: it conflicts with the FOR KEY
//      SHARE a checkout's order-line insert takes on its product and variant
//      (Inventory.lockReferences), so no order line can be written against a
//      source while the merge repoints them. A checkout that was waiting finds
//      the product merged and is refused (Order.createWithItems).
//   3. re-load under those locks, re-plan, compare `expect` → STALE_PREVIEW
//   4. new variant rows; moved variant rows change parent
//   5. ONE Inventory.applyLines — the only writer of on hand: merge_out on the
//      source + merge_in on the survivor per unit that carried stock (net zero,
//      each an audited inventory_adjustments row with the actor), and a
//      zero-delta `merge` row per MOVED variant so the survivor's stock history
//      says where that row came from
//   6. repoint every FK row per repointSpec (the spec must cover pg_constraint)
//   7. mapped source variants switched off (barcode handed over when the target
//      has none), empty survivor fields filled from a source
//   8. sources → inactive, merged_into_id = survivor, own codes cleared
//   9. one product_merges row per source + one staff_audit_log row
//
// Nothing here deletes a product or a variant: history that stays (audit
// trails, switched-off variants, issued invoices) keeps a parent row.
const db = require('../../config/database');
const Inventory = require('../../models/Inventory');
const ProductMerge = require('../../models/ProductMerge');
const staffAudit = require('../staffAudit');
const { SPEC, assertCovers } = require('./repointSpec');
const { plan, propose } = require('./planner');

const ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
const DEFAULT_LOCK_TIMEOUT_MS = 3000;
const PRODUCT_COLS = `id, slug, name, sku, barcode, category, is_bookable, price_isk, price_eur, stock, vat_rate,
  active, merged_into_id, variant_axes, bin, description, description_is, name_is, weight_grams, subcategory, updated_at`;
const VARIANT_COLS = 'id, product_id, sku, barcode, attributes, price_isk, price_eur, stock, bin, active';

function badRequest(code) {
  const e = new Error(code); e.code = 'MERGE_BAD_REQUEST'; e.reason = code; return e;
}

// → { masterId, ids } validated shape, or throws MERGE_BAD_REQUEST
function normaliseIds(body) {
  const masterId = String(body && body.master || '').trim();
  if (!ID_RE.test(masterId)) throw badRequest('master_invalid');
  const raw = Array.isArray(body && body.ids) ? body.ids : [];
  const ids = [...new Set(raw.map(x => String(x == null ? '' : x).trim()))];
  if (!ids.length) throw badRequest('ids_missing');
  if (ids.length > 20) throw badRequest('too_many');
  if (ids.some(id => !ID_RE.test(id))) throw badRequest('ids_invalid');
  // Merging a product into itself is refused before anything is read.
  if (ids.includes(masterId)) throw badRequest('master_in_sources');
  return { masterId, ids };
}

async function loadState(q, masterId, ids) {
  const all = [masterId, ...ids];
  const { rows: products } = await q(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ANY($1::text[])`, [all]);
  const byId = new Map(products.map(p => [String(p.id), { ...p, variants: [] }]));
  if (!byId.has(masterId)) throw badRequest('master_not_found');
  const missing = ids.filter(id => !byId.has(id));
  if (missing.length) { const e = badRequest('source_not_found'); e.ids = missing; throw e; }
  const { rows: variants } = await q(
    `SELECT ${VARIANT_COLS} FROM product_variants WHERE product_id = ANY($1::text[]) ORDER BY id`, [all]);
  for (const v of variants) byId.get(String(v.product_id)).variants.push(v);

  // SKUs a NEW variant would collide with (product_variants.sku is unique
  // across the table, switched-off rows included).
  const candidates = ids.map(id => byId.get(id)).filter(p => !(p.variants || []).some(v => v.active !== false))
    .map(p => String(p.sku || p.slug || '').toLowerCase()).filter(Boolean);
  const variantSkus = new Map();
  if (candidates.length) {
    const { rows } = await q(`SELECT lower(sku) AS sku, id FROM product_variants WHERE lower(sku) = ANY($1::text[])`, [candidates]);
    for (const r of rows) variantSkus.set(r.sku, r.id);
  }
  return { master: byId.get(masterId), sources: ids.map(id => byId.get(id)), variantSkus };
}

const view = (p) => ({
  id: p.id, slug: p.slug, name: p.name, sku: p.sku, barcode: p.barcode, category: p.category,
  price_isk: p.price_isk, price_eur: p.price_eur, vat_rate: p.vat_rate, stock: p.stock,
  active: p.active, variant_axes: p.variant_axes, bin: p.bin,
  variants: (p.variants || []).filter(v => v.active !== false).map(v => ({
    id: v.id, sku: v.sku, barcode: v.barcode, attributes: v.attributes,
    price_isk: v.price_isk, price_eur: v.price_eur, stock: v.stock, bin: v.bin,
  })),
  inactive_variant_count: (p.variants || []).filter(v => v.active === false).length,
});

// Read-only preview: the planner over current rows. With no variant_map the
// proposal (barcode → attributes → the name's colour) is planned instead, so
// the screen opens with the best guess already chosen.
async function preview(body) {
  const { masterId, ids } = normaliseIds(body);
  const state = await loadState((t, p) => db.query(t, p), masterId, ids);
  const proposal = propose(state);
  const request = Array.isArray(body.variant_map) ? body : { ...body, variant_map: proposal.variant_map };
  const result = plan(state, request);
  return {
    master: view(state.master),
    sources: state.sources.map(view),
    proposal,
    plan: {
      ok: result.ok, refusals: result.refusals, warnings: result.warnings, shape: result.shape,
      axes: result.axes, stockMode: result.stockMode, summary: result.summary,
      units: result.units.map(u => ({
        key: u.key, productId: u.productId, variantId: u.variantId, name: u.name, sku: u.sku, barcode: u.barcode,
        attributes: u.attributes, stock: u.stock, target: u.target, kind: u.kind, newAttributes: u.newAttributes,
      })),
    },
    request: result.request,
    expect: result.expect,
  };
}

// ── the transaction ─────────────────────────────────────────────────────────

function mergeError(code, extra = {}) {
  const e = new Error(code); e.code = code; Object.assign(e, extra); return e;
}

const byId = (a, b) => a.localeCompare(b);

// The lock pass (step 2). Returns ms spent waiting.
async function takeLocks(q, all, ids) {
  const t = Date.now();
  await q(`SELECT id FROM orders WHERE id IN (SELECT order_id FROM order_items WHERE product_id = ANY($1::text[]))
            ORDER BY id FOR UPDATE`, [all]);
  // Products merged earlier INTO a source are re-pointed by the flatten step:
  // they join the product pass here rather than being locked later, out of order.
  const { rows: prior } = await q(`SELECT id FROM products WHERE merged_into_id = ANY($1::text[])`, [ids]);
  const productIds = [...new Set([...all, ...prior.map(r => String(r.id))])].sort(byId);
  const { rows: vrows } = await q(`SELECT id, product_id FROM product_variants WHERE product_id = ANY($1::text[])`, [all]);
  const parents = new Set(vrows.map(r => String(r.product_id)));
  for (const id of productIds.filter(p => parents.has(p))) {
    await q('SELECT 1 FROM products WHERE id = $1 FOR UPDATE', [id]);
  }
  for (const id of vrows.map(r => String(r.id)).sort(byId)) {
    await q('SELECT 1 FROM product_variants WHERE id = $1 FOR UPDATE', [id]);
  }
  for (const id of productIds.filter(p => !parents.has(p))) {
    await q('SELECT 1 FROM products WHERE id = $1 FOR UPDATE', [id]);
  }
  return Date.now() - t;
}

// merge_out/merge_in: the source's on hand moves to the target, net zero.
function stockPair(from, to, qty) {
  const n = Math.trunc(Number(qty) || 0);
  if (n <= 0) return [];
  return [
    { productId: from.productId, variantId: from.variantId, mode: 'decrement', qty: n, reason: 'merge_out' },
    { productId: to.productId, variantId: to.variantId, mode: 'increment', qty: n, reason: 'merge_in' },
  ];
}

async function apply(body, { userId = null, requestId = null, lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = {}) {
  const t0 = Date.now();
  const { masterId, ids } = normaliseIds(body);
  const expectIn = String(body.expect || '');
  if (!expectIn) throw badRequest('expect_missing');
  assertCovers(await ProductMerge.productForeignKeys());

  const client = await db.pool.connect();
  const q = (text, params) => client.query(text, params);
  try {
    await q('BEGIN');
    const timeout = Math.max(100, Math.min(30000, Math.trunc(Number(lockTimeoutMs) || DEFAULT_LOCK_TIMEOUT_MS)));
    await q(`SET LOCAL lock_timeout = '${timeout}ms'`);
    const all = [masterId, ...ids];
    const lockWaitMs = await takeLocks(q, all, ids);

    const state = await loadState(q, masterId, ids);
    const result = plan(state, body);
    if (!result.ok) throw mergeError('MERGE_REFUSED', { refusals: result.refusals });
    if (result.expect !== expectIn) throw mergeError('STALE_PREVIEW');

    const counts = {};
    const bump = (k, n) => { if (n) counts[k] = (counts[k] || 0) + n; };
    const master = state.master;
    const sourceById = new Map(state.sources.map(s => [String(s.id), s]));
    const mappedVariants = new Map();   // source variant → master variant
    const movedVariants = [];           // variant ids that changed parent
    const simpleToVariant = new Map();  // simple source product → master variant
    const stockLines = [];
    const variantMap = [];

    for (const u of result.units) {
      const s = sourceById.get(u.productId);
      const srcVariant = u.variantId ? s.variants.find(v => String(v.id) === u.variantId) : null;
      let targetVariantId = null;

      if (u.kind === 'move') {
        // The row keeps its id, SKU, barcode and stock; only its parent and
        // attributes change. An inherited price is pinned onto the row when
        // the survivor's differs, so what it sells for does not change by accident.
        await q(
          `UPDATE product_variants
              SET product_id = $2, attributes = $3::jsonb,
                  price_isk = COALESCE(price_isk, CASE WHEN $4::int <> $5::int THEN $4::int END),
                  price_eur = COALESCE(price_eur, CASE WHEN $6::int <> $7::int THEN $6::int END),
                  bin = COALESCE(bin, $8), updated_at = NOW()
            WHERE id = $1`,
          [u.variantId, masterId, JSON.stringify(u.newAttributes),
           Number(s.price_isk), Number(master.price_isk), Number(s.price_eur), Number(master.price_eur),
           s.bin && s.bin !== master.bin ? s.bin : null]);
        movedVariants.push(u.variantId);
        targetVariantId = u.variantId;
        // An audit row on the survivor: this row's stock arrived with the merge.
        stockLines.push({ productId: masterId, variantId: u.variantId, mode: 'increment', qty: 0, reason: 'merge',
          note: `merge from ${String(s.slug).slice(0, 200)}` });
        bump('variants_moved', 1);
      } else if (u.kind === 'new') {
        const srcPrice = Number(s.price_isk), srcEur = Number(s.price_eur);
        const { rows } = await q(
          `INSERT INTO product_variants (product_id, sku, attributes, price_isk, price_eur, stock, bin, barcode, active)
           VALUES ($1, $2, $3::jsonb, $4, $5, 0, $6, $7, TRUE) RETURNING id`,
          [masterId, u.newSku, JSON.stringify(u.newAttributes),
           srcPrice !== Number(master.price_isk) ? srcPrice : null,
           srcEur !== Number(master.price_eur) ? srcEur : null,
           s.bin && s.bin !== master.bin ? s.bin : null, s.barcode || null]);
        targetVariantId = String(rows[0].id);
        simpleToVariant.set(u.productId, targetVariantId);
        bump('variants_created', 1);
        stockLines.push(...stockPair({ productId: u.productId, variantId: null }, { productId: masterId, variantId: targetVariantId }, u.stock));
      } else if (u.kind === 'map') {
        targetVariantId = String(u.target.variantId);
        if (u.variantId) mappedVariants.set(u.variantId, targetVariantId);
        else simpleToVariant.set(u.productId, targetVariantId);
        const tv = master.variants.find(v => String(v.id) === targetVariantId);
        if (u.barcode && !tv.barcode) {
          // The scanner keeps working: the target takes the source's barcode
          // when it has none (the source loses it below either way).
          if (u.variantId) await q('UPDATE product_variants SET barcode = NULL WHERE id = $1', [u.variantId]);
          await q('UPDATE product_variants SET barcode = $2, updated_at = NOW() WHERE id = $1 AND barcode IS NULL', [targetVariantId, u.barcode]);
          bump('barcodes_moved', 1);
        }
        const srcBin = (srcVariant && srcVariant.bin) || s.bin || null;
        if (srcBin && !tv.bin) {
          await q('UPDATE product_variants SET bin = $2, updated_at = NOW() WHERE id = $1 AND bin IS NULL', [targetVariantId, srcBin]);
          bump('bins_filled', 1);
        }
        stockLines.push(...stockPair({ productId: u.productId, variantId: u.variantId }, { productId: masterId, variantId: targetVariantId }, u.stock));
      } else if (u.kind === 'master') {
        if (u.barcode && !master.barcode) {
          await q('UPDATE products SET barcode = $2 WHERE id = $1 AND barcode IS NULL', [masterId, u.barcode]);
          bump('barcodes_moved', 1);
        }
        stockLines.push(...stockPair({ productId: u.productId, variantId: null }, { productId: masterId, variantId: null }, u.stock));
      }
      variantMap.push({
        source_product_id: u.productId, source_variant_id: u.variantId, source_sku: u.sku, source_barcode: u.barcode,
        kind: u.kind, target_product_id: masterId, target_variant_id: u.kind === 'master' ? null : targetVariantId,
        attributes: u.newAttributes || null, stock: u.stock,
      });
    }

    // 5. stock — ONE call, audited, in the module's own lock order (the rows
    //    are already ours, so it cannot wait on anyone).
    if (stockLines.length) {
      const moved = await Inventory.applyLines(client, stockLines, { userId });
      bump('stock_lines', moved.length);
    }

    // 6. repoint
    const sourceIds = ids;
    const pairs = [...mappedVariants.entries()];
    for (const e of SPEC) {
      const key = `${e.table}.${e.product}`;
      if (e.policy === 'stay' || e.policy === 'variants') continue;
      if (e.policy === 'flatten') {
        const r = await q('UPDATE products SET merged_into_id = $1 WHERE merged_into_id = ANY($2::text[])', [masterId, sourceIds]);
        bump(key, r.rowCount);
        continue;
      }
      if (e.policy === 'repoint_draft') {
        // Draft invoices only. An ISSUED invoice line is in the books and is
        // never rewritten — the database would refuse it anyway
        // (trg_invoice_lines_immutable), which would roll the whole merge back.
        const r = await q(
          `UPDATE invoice_lines SET product_id = $1
            WHERE product_id = ANY($2::text[])
              AND invoice_id IN (SELECT id FROM invoices WHERE status = 'draft')`, [masterId, sourceIds]);
        bump(key, r.rowCount);
        continue;
      }
      if (e.policy === 'dedupe') {
        const keyEq = (a, b) => e.key.map(k => `${a}.${k} = ${b}.${k}`).join(' AND ');
        const d1 = await q(
          `DELETE FROM ${e.table} s WHERE s.${e.product} = ANY($2::text[])
             AND EXISTS (SELECT 1 FROM ${e.table} m WHERE m.${e.product} = $1 AND ${keyEq('m', 's')})`, [masterId, sourceIds]);
        const d2 = await q(
          `DELETE FROM ${e.table} a USING ${e.table} b
            WHERE a.${e.product} = ANY($1::text[]) AND b.${e.product} = ANY($1::text[])
              AND ${keyEq('a', 'b')} AND a.${e.product} > b.${e.product}`, [sourceIds]);
        const r = await q(`UPDATE ${e.table} SET ${e.product} = $1 WHERE ${e.product} = ANY($2::text[])`, [masterId, sourceIds]);
        bump(key, r.rowCount);
        bump(`${key}:deduped`, d1.rowCount + d2.rowCount);
        continue;
      }
      if (e.policy === 'images') {
        // After the survivor's own images, in the sources' order; a URL the
        // survivor already shows stays where it is (the duplicate row is left
        // on the merged product rather than deleted).
        const r = await q(
          `WITH base AS (SELECT COALESCE(MAX(position), -1) AS top FROM product_images WHERE product_id = $1),
                moving AS (
                  SELECT i.id, ROW_NUMBER() OVER (ORDER BY array_position($2::text[], i.product_id), i.position, i.created_at, i.id) AS n
                    FROM product_images i
                   WHERE i.product_id = ANY($2::text[])
                     AND NOT EXISTS (SELECT 1 FROM product_images m WHERE m.product_id = $1 AND m.url = i.url))
           UPDATE product_images p SET product_id = $1, position = (SELECT top FROM base) + moving.n
             FROM moving WHERE p.id = moving.id`, [masterId, sourceIds]);
        bump(key, r.rowCount);
        continue;
      }
      // repoint (order_items): every line follows its unit.
      if (e.variant) {
        for (const [sv, tv] of pairs) {
          const r = await q(`UPDATE ${e.table} SET ${e.product} = $1, ${e.variant} = $2 WHERE ${e.variant} = $3`, [masterId, tv, sv]);
          bump(key, r.rowCount);
        }
        if (movedVariants.length) {
          const r = await q(`UPDATE ${e.table} SET ${e.product} = $1 WHERE ${e.variant} = ANY($2::text[])`, [masterId, movedVariants]);
          bump(key, r.rowCount);
        }
        for (const [sp, tv] of simpleToVariant) {
          const r = await q(`UPDATE ${e.table} SET ${e.product} = $1, ${e.variant} = $2 WHERE ${e.product} = $3 AND ${e.variant} IS NULL`, [masterId, tv, sp]);
          bump(key, r.rowCount);
        }
        // Lines on a source's product level (a simple source into a simple
        // survivor). Lines on a switched-off source variant that was NOT part
        // of this merge stay where they are — that row still exists.
        const r = await q(`UPDATE ${e.table} SET ${e.product} = $1 WHERE ${e.product} = ANY($2::text[]) AND ${e.variant} IS NULL`, [masterId, sourceIds]);
        bump(key, r.rowCount);
      } else {
        const r = await q(`UPDATE ${e.table} SET ${e.product} = $1 WHERE ${e.product} = ANY($2::text[])`, [masterId, sourceIds]);
        bump(key, r.rowCount);
      }
    }

    // 7. mapped source variants switched off (a retired row's barcode is not a
    //    live claim — cleared; the SKU stays, unique, and resolves to the
    //    target through the merge log: ProductMerge.resolveLive).
    if (pairs.length) {
      const r = await q(
        `UPDATE product_variants SET active = FALSE, barcode = NULL, updated_at = NOW()
          WHERE id = ANY($1::text[])`, [pairs.map(([sv]) => sv)]);
      bump('variants_switched_off', r.rowCount);
    }
    const blank = (v) => v == null || v === '';
    const fill = {};
    for (const col of ['description', 'description_is', 'name_is', 'weight_grams', 'subcategory']) {
      if (!blank(master[col])) continue;
      const donor = state.sources.find(s => !blank(s[col]));
      if (donor) fill[col] = donor[col];
    }
    if (!master.bin && result.shape === 'simple') {
      const donor = state.sources.find(s => s.bin);
      if (donor) fill.bin = donor.bin;
    }
    if (Object.keys(fill).length) {
      const cols = Object.keys(fill);
      await q(`UPDATE products SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
        [masterId, ...cols.map(c => fill[c])]);
      bump('master_fields_filled', cols.length);
    }

    // 8. the sources: inactive, pointing at the survivor, their own codes freed
    //    (a simple source's SKU now lives on its new variant).
    await q(
      `UPDATE products SET active = FALSE, merged_into_id = $1, sku = NULL, barcode = NULL, updated_at = NOW()
        WHERE id = ANY($2::text[])`, [masterId, sourceIds]);

    // 9. the log — the only record of what moved — and the staff audit row.
    const ms = Date.now() - t0;
    const mergeIds = [];
    for (const s of state.sources) {
      const units = variantMap.filter(v => v.source_product_id === String(s.id));
      const { rows } = await q(
        `INSERT INTO product_merges (master_id, merged_id, shape, stock_mode, variant_map,
                                     merged_name, merged_slug, merged_sku, merged_barcode, stock_moved,
                                     counts, warnings, lock_wait_ms, ms, merged_by)
         VALUES ($1,$2,$3,'move',$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14) RETURNING id`,
        [masterId, s.id, result.shape, JSON.stringify(units),
         s.name, s.slug, s.sku || null, s.barcode || null,
         units.filter(v => v.kind !== 'move').reduce((n, v) => n + (v.stock > 0 ? v.stock : 0), 0),
         JSON.stringify(counts), JSON.stringify(result.warnings), lockWaitMs, ms, userId]);
      mergeIds.push(rows[0].id);
    }
    await staffAudit.record(client, {
      actorId: userId, requestId, action: 'product.merged', entityType: 'product', entityId: masterId,
      summary: { merged: sourceIds, mergeIds, shape: result.shape, units: result.units.length, stockMoved: result.summary.stockMoved },
    });

    await q('COMMIT');
    return {
      mergeIds, masterId, merged: sourceIds, shape: result.shape, stockMode: 'move',
      summary: result.summary, counts, warnings: result.warnings, lockWaitMs, ms: Date.now() - t0,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection gone */ }
    // Lock timeout, or a deadlock Postgres broke by cancelling us: either way
    // someone else is working on these rows right now.
    if (err && (err.code === '55P03' || err.code === '40P01')) throw mergeError('MERGE_BUSY');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { preview, apply, loadState, normaliseIds, stockPair, DEFAULT_LOCK_TIMEOUT_MS };
