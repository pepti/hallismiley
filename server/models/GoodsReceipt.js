// GoodsReceipt — a supplier delivery checked in against the supplier's own
// file (migration 118_goods_receipts). Ported from icelandicstore #23
// (models/GoodsReceipt.js + services/goodsReceipt/finalizeReceipt.js),
// harvest 2 lane 6a, with three engine differences:
//   • lines are matched to the catalogue by OUR code only — SKU (variant
//     first), then barcode — never by ice's fuzzy description matcher; an
//     ambiguous or unknown code stays 'unmatched' for a person to resolve;
//   • no suppliers table: the supplier's name is text on the receipt;
//   • finalise is ONE transaction under the receipt's row lock — the status
//     check, Inventory.applyBatch (reason 'receipt') and the status flip commit
//     together — so a second finalise waits, then finds 'finalized' and is
//     refused. ice needed a 'finalizing' claim state for the same guarantee.
//
// received_qty is DERIVED from the scan log (recomputed on every scan and
// undo), so an undo can never drift from what was physically scanned.
//
// Lock order: the goods_receipts row first (FOR UPDATE), then the stock rows
// in the Inventory module's order — FOR UPDATE through Inventory.applyBatch at
// finalise, and FOR KEY SHARE through Inventory.lockReferences before any
// line or scan insert/update whose product/variant foreign keys would
// otherwise share-lock them in the supplier file's order (a cycle with a
// fulfilment or a count; harvest2-lane6a review). No stock writer ever locks
// a receipt, so the receipt-first order cannot cycle either.
const db = require('../config/database');
const Inventory = require('./Inventory');

const STATUSES = ['draft', 'finalized', 'cancelled'];
// Lines the admin may set by hand. 'manual' is a line a person re-matched;
// 'new_product' / 'skipped' take no part in the reconciliation or the stock.
const LINE_STATES = ['matched', 'unmatched', 'manual', 'skipped', 'new_product'];
const EXCLUDED_STATES = new Set(['skipped', 'new_product']);
const MAX_LINES = 2000;
const MAX_SCAN_QTY = 100000;

function typed(message, code, status, extra = {}) {
  const e = new Error(message);
  e.code = code; e.status = status;
  Object.assign(e, extra);
  return e;
}

// Expected vs received for one line. Ported from ice's computeVariance.
function computeVariance(expected, received) {
  const e = Math.max(0, Math.trunc(Number(expected) || 0));
  const r = Math.max(0, Math.trunc(Number(received) || 0));
  if (r === 0) return e > 0 ? 'not_received' : 'pending';
  if (e === 0) return 'over';
  if (r < e) return 'short';
  if (r > e) return 'over';
  return 'exact';
}

const scanKey = (productId, variantId) => `${productId}|${variantId || ''}`;

const GoodsReceipt = {
  STATUSES,
  LINE_STATES,
  MAX_LINES,
  MAX_SCAN_QTY,
  computeVariance,
  scanKey,

  async create({ supplierName, reference = null, note = null, createdBy = null }) {
    const { rows } = await db.query(
      `INSERT INTO goods_receipts (supplier_name, reference, note, status, created_by)
       VALUES ($1, $2, $3, 'draft', $4) RETURNING *`,
      [String(supplierName), reference || null, note || null, createdBy ? String(createdBy) : null]
    );
    return rows[0];
  },

  async findById(id) {
    const { rows } = await db.query(
      `SELECT gr.*, cu.username AS created_by_name, fu.username AS finalized_by_name
         FROM goods_receipts gr
         LEFT JOIN users cu ON cu.id = gr.created_by
         LEFT JOIN users fu ON fu.id = gr.finalized_by
        WHERE gr.id = $1`,
      [String(id)]
    );
    return rows[0] || null;
  },

  async list({ status = null, limit = 100 } = {}) {
    const params = [];
    let where = '';
    if (status && STATUSES.includes(status)) { params.push(status); where = `WHERE gr.status = $1`; }
    params.push(Math.max(1, Math.min(200, Math.trunc(Number(limit) || 100))));
    const { rows } = await db.query(
      `SELECT gr.id, gr.supplier_name, gr.reference, gr.status, gr.created_at, gr.finalized_at,
              (SELECT COUNT(*)::int FROM goods_receipt_lines l WHERE l.receipt_id = gr.id) AS line_count,
              (SELECT COALESCE(SUM(l.expected_qty), 0)::int FROM goods_receipt_lines l
                WHERE l.receipt_id = gr.id AND l.match_status NOT IN ('skipped', 'new_product')) AS expected_units,
              (SELECT COALESCE(SUM(s.qty), 0)::int FROM goods_receipt_scans s WHERE s.receipt_id = gr.id) AS scanned_units
         FROM goods_receipts gr
        ${where}
        ORDER BY gr.created_at DESC, gr.id DESC
        LIMIT $${params.length}`,
      params
    );
    return rows;
  },

  // Lines with the matched item's live code, bin, name and on hand.
  async lines(receiptId) {
    const { rows } = await db.query(
      `SELECT l.id, l.receipt_id, l.supplier_description, l.supplier_ref, l.sku AS file_sku, l.barcode,
              l.expected_qty, l.received_qty, l.unit_cost, l.product_id, l.variant_id,
              l.match_status, l.sort_order,
              p.name AS product_name, pv.attributes,
              COALESCE(pv.sku, p.sku) AS sku, COALESCE(pv.bin, p.bin) AS bin,
              CASE WHEN l.variant_id IS NOT NULL THEN pv.stock ELSE p.stock END AS on_hand
         FROM goods_receipt_lines l
         LEFT JOIN products p          ON p.id  = l.product_id
         LEFT JOIN product_variants pv ON pv.id = l.variant_id
        WHERE l.receipt_id = $1
        ORDER BY l.sort_order ASC, l.id ASC`,
      [String(receiptId)]
    );
    return rows.map(r => ({
      ...r,
      // An unmatched line has no difference yet: nothing can be scanned onto it.
      variance: EXCLUDED_STATES.has(r.match_status) || !r.product_id
        ? null : computeVariance(r.expected_qty, r.received_qty),
    }));
  },

  async scans(receiptId, { limit = 50 } = {}) {
    const { rows } = await db.query(
      `SELECT s.id, s.receipt_line_id, s.product_id, s.variant_id, s.scanned_code, s.qty, s.created_at,
              p.name AS product_name, pv.attributes, COALESCE(pv.sku, p.sku) AS sku, u.username AS scanned_by_name
         FROM goods_receipt_scans s
         LEFT JOIN products p          ON p.id  = s.product_id
         LEFT JOIN product_variants pv ON pv.id = s.variant_id
         LEFT JOIN users u             ON u.id  = s.scanned_by
        WHERE s.receipt_id = $1
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT $2`,
      [String(receiptId), Math.max(1, Math.min(500, Math.trunc(Number(limit) || 50)))]
    );
    return rows;
  },

  // Scanned goods that matched NO line, grouped by product/variant: "received
  // but not on the invoice". Received into stock at finalise unless excluded.
  async extras(receiptId) {
    const { rows } = await db.query(
      `SELECT s.product_id, s.variant_id, p.name AS product_name, pv.attributes,
              COALESCE(pv.sku, p.sku) AS sku, SUM(s.qty)::int AS qty
         FROM goods_receipt_scans s
         LEFT JOIN products p          ON p.id  = s.product_id
         LEFT JOIN product_variants pv ON pv.id = s.variant_id
        WHERE s.receipt_id = $1 AND s.receipt_line_id IS NULL AND s.product_id IS NOT NULL
        GROUP BY s.product_id, s.variant_id, p.name, pv.attributes, pv.sku, p.sku
        ORDER BY p.name ASC, s.variant_id NULLS FIRST`,
      [String(receiptId)]
    );
    return rows.map(r => ({ ...r, key: scanKey(r.product_id, r.variant_id) }));
  },

  summarise(lines, extras) {
    const live = lines.filter(l => !EXCLUDED_STATES.has(l.match_status));
    return {
      lines: lines.length,
      matched: live.filter(l => l.product_id).length,
      unmatched: live.filter(l => !l.product_id).length,
      skipped: lines.length - live.length,
      exact: live.filter(l => l.variance === 'exact').length,
      short: live.filter(l => l.variance === 'short' || l.variance === 'not_received').length,
      over: live.filter(l => l.variance === 'over').length,
      notOnInvoice: extras.length,
      expectedUnits: live.reduce((s, l) => s + (Number(l.expected_qty) || 0), 0),
      receivedUnits: live.reduce((s, l) => s + (Number(l.received_qty) || 0), 0)
        + extras.reduce((s, x) => s + (Number(x.qty) || 0), 0),
    };
  },

  async state(receiptId) {
    const receipt = await GoodsReceipt.findById(receiptId);
    if (!receipt) return null;
    const [lines, extras, scans] = await Promise.all([
      GoodsReceipt.lines(receiptId),
      GoodsReceipt.extras(receiptId),
      GoodsReceipt.scans(receiptId),
    ]);
    return { receipt, lines, extras, scans, summary: GoodsReceipt.summarise(lines, extras) };
  },

  // ── matching ──────────────────────────────────────────────────────────────

  // Our code → one stocked unit. Rows: [{ sku, barcode }]. Returns, per row,
  // { productId, variantId, matchStatus } — SKU first (a variant's own SKU
  // before a product's), then barcode. A code on more than one row, or a
  // product-level hit on a product WITH variants, is left unmatched: a person
  // decides, nothing is guessed (the product import's rule too).
  async matchCodes(rows) {
    const skus = [...new Set(rows.map(r => r.sku).filter(Boolean).map(String))];
    const bars = [...new Set(rows.map(r => r.barcode).filter(Boolean).map(String))];
    const bySku = new Map();
    const byBar = new Map();
    const add = (map, code, hit) => {
      if (!code) return;
      const list = map.get(code) || [];
      list.push(hit);
      map.set(code, list);
    };
    if (skus.length || bars.length) {
      const { rows: vs } = await db.query(
        `SELECT v.id AS variant_id, v.product_id, v.sku, v.barcode
           FROM product_variants v
          WHERE v.sku = ANY($1::text[]) OR v.barcode = ANY($2::text[])`,
        [skus, bars]
      );
      const { rows: ps } = await db.query(
        `SELECT p.id AS product_id, p.sku, p.barcode,
                (p.variant_axes IS NOT NULL AND p.variant_axes <> '[]'::jsonb) AS has_variants
           FROM products p
          WHERE p.sku = ANY($1::text[]) OR p.barcode = ANY($2::text[])`,
        [skus, bars]
      );
      for (const v of vs) {
        const hit = { productId: v.product_id, variantId: v.variant_id };
        if (v.sku && skus.includes(v.sku)) add(bySku, v.sku, { ...hit, tier: 0 });
        if (v.barcode && bars.includes(v.barcode)) add(byBar, v.barcode, hit);
      }
      for (const p of ps) {
        const hit = { productId: p.product_id, variantId: null, variantParent: p.has_variants };
        if (p.sku && skus.includes(p.sku)) add(bySku, p.sku, { ...hit, tier: 1 });
        if (p.barcode && bars.includes(p.barcode)) add(byBar, p.barcode, hit);
      }
    }
    const pick = (hits) => {
      if (!hits || !hits.length) return null;
      // A variant's own SKU wins over a product that happens to share it.
      const best = Math.min(...hits.map(h => h.tier || 0));
      const top = hits.filter(h => (h.tier || 0) === best);
      if (top.length !== 1) return { ambiguous: true };
      return top[0];
    };
    return rows.map((r) => {
      const hit = pick(bySku.get(r.sku)) || pick(byBar.get(r.barcode));
      if (!hit || hit.ambiguous || hit.variantParent) {
        return { productId: null, variantId: null, matchStatus: 'unmatched' };
      }
      return { productId: hit.productId, variantId: hit.variantId, matchStatus: 'matched' };
    });
  },

  // Append supplier lines to a DRAFT receipt: match, then insert, under the
  // receipt row lock. rows: [{ sku, barcode, description, supplierRef,
  // expectedQty, unitCost }]. → { added, matched }.
  async addLines(receiptId, rows) {
    if (!Array.isArray(rows) || !rows.length) throw typed('No lines', 'NO_LINES', 400);
    const matches = await GoodsReceipt.matchCodes(rows);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const receipt = await GoodsReceipt._lockDraft(client, receiptId);
      await Inventory.lockReferences(client, matches.filter(m => m.productId));
      const { rows: cnt } = await client.query(
        `SELECT COUNT(*)::int AS n, COALESCE(MAX(sort_order), -1)::int AS last
           FROM goods_receipt_lines WHERE receipt_id = $1`, [receipt.id]
      );
      if (cnt[0].n + rows.length > MAX_LINES) throw typed('Too many lines', 'TOO_MANY_LINES', 400, { max: MAX_LINES });
      let order = cnt[0].last + 1;
      let matched = 0;
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        const m = matches[i];
        if (m.productId) matched += 1;
        await client.query(
          `INSERT INTO goods_receipt_lines
             (receipt_id, supplier_description, supplier_ref, sku, barcode, expected_qty, unit_cost,
              product_id, variant_id, match_status, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [receipt.id, r.description || null, r.supplierRef || null, r.sku || null, r.barcode || null,
           r.expectedQty, r.unitCost == null ? null : r.unitCost,
           m.productId, m.variantId, m.matchStatus, order]
        );
        order += 1;
      }
      // A scan that arrived before its line was imported now belongs to it.
      await GoodsReceipt._reattachScans(client, receipt.id);
      await client.query('COMMIT');
      return { added: rows.length, matched };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  // Re-match, skip or re-count one line of a DRAFT receipt. patch: {
  // productId?, variantId?, matchStatus?, expectedQty? }. A new product/variant
  // is checked to exist and to be a stocked unit (never a variant product's
  // own row).
  async updateLine(receiptId, lineId, patch) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const receipt = await GoodsReceipt._lockDraft(client, receiptId);
      const { rows: cur } = await client.query(
        `SELECT * FROM goods_receipt_lines WHERE id = $1 AND receipt_id = $2`, [String(lineId), receipt.id]
      );
      if (!cur[0]) throw typed('Line not found', 'LINE_NOT_FOUND', 404);
      const line = cur[0];
      let productId = line.product_id;
      let variantId = line.variant_id;
      let status = line.match_status;
      let expected = line.expected_qty;
      if (patch.productId !== undefined) {
        if (!patch.productId) {
          productId = null; variantId = null;
          if (status === 'matched' || status === 'manual') status = 'unmatched';
        } else {
          const [item] = await Inventory.stockItems([{ productId: patch.productId, variantId: patch.variantId || null }]);
          if (!item) throw typed('Product not found', 'PRODUCT_NOT_FOUND', 404);
          if (item.variant_required) throw typed('Choose a variant', 'VARIANT_REQUIRED', 409);
          productId = item.product_id; variantId = item.variant_id;
          status = 'manual';
          await Inventory.lockReferences(client, [{ productId, variantId }]);
        }
      }
      if (patch.matchStatus !== undefined) status = patch.matchStatus;
      if (patch.expectedQty !== undefined) expected = patch.expectedQty;
      if ((status === 'matched' || status === 'manual') && !productId) status = 'unmatched';
      await client.query(
        `UPDATE goods_receipt_lines
            SET product_id = $1, variant_id = $2, match_status = $3, expected_qty = $4
          WHERE id = $5`,
        [productId, variantId, status, expected, line.id]
      );
      await GoodsReceipt._reattachScans(client, receipt.id);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  // One physical scan on a DRAFT receipt. The caller has resolved the code to
  // a stocked unit. → { lineId, matched }.
  async addScan(receiptId, { code, productId, variantId = null, qty = 1, scannedBy = null }) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const receipt = await GoodsReceipt._lockDraft(client, receiptId);
      await Inventory.lockReferences(client, [{ productId, variantId }]);
      const lineId = await GoodsReceipt._lineFor(client, receipt.id, productId, variantId);
      await client.query(
        `INSERT INTO goods_receipt_scans
           (receipt_id, receipt_line_id, product_id, variant_id, scanned_code, qty, scanned_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [receipt.id, lineId, String(productId), variantId ? String(variantId) : null,
         String(code).slice(0, 200), qty, scannedBy ? String(scannedBy) : null]
      );
      if (lineId) await GoodsReceipt._recomputeLine(client, lineId);
      await client.query('COMMIT');
      return { lineId, matched: Boolean(lineId) };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  // Undo one scan (recomputed from the rest — never a decrement).
  async deleteScan(receiptId, scanId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const receipt = await GoodsReceipt._lockDraft(client, receiptId);
      const { rows } = await client.query(
        `DELETE FROM goods_receipt_scans WHERE id = $1 AND receipt_id = $2 RETURNING receipt_line_id`,
        [String(scanId), receipt.id]
      );
      if (!rows[0]) throw typed('Scan not found', 'SCAN_NOT_FOUND', 404);
      if (rows[0].receipt_line_id) await GoodsReceipt._recomputeLine(client, rows[0].receipt_line_id);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  async cancel(receiptId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const receipt = await GoodsReceipt._lockDraft(client, receiptId);
      await client.query(`UPDATE goods_receipts SET status = 'cancelled' WHERE id = $1`, [receipt.id]);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  // Finalise: in ONE transaction, lock the receipt, refuse anything but a
  // draft (a second finalise waits on the lock, then finds 'finalized'),
  // refuse while a counted line is unmatched, then move stock by what was
  // RECEIVED (never what was expected) as one Inventory.applyBatch (reason
  // 'receipt', the receipt's id on every row) and mark it finalized. A refused
  // batch rolls the whole thing back and the receipt stays a draft.
  // excludeExtras: scanKey()s of not-on-invoice groups NOT to receive.
  // → { batchId, units, lines }.
  async finalize(receiptId, { userId = null, excludeExtras = [] } = {}) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const receipt = await GoodsReceipt._lockDraft(client, receiptId);
      const { rows: lines } = await client.query(
        `SELECT id, product_id, variant_id, received_qty, match_status
           FROM goods_receipt_lines WHERE receipt_id = $1`, [receipt.id]
      );
      const live = lines.filter(l => !EXCLUDED_STATES.has(l.match_status));
      const unresolved = live.filter(l => !l.product_id);
      if (unresolved.length) {
        throw typed('Unmatched lines', 'INCOMPLETE', 409, { lineIds: unresolved.map(l => l.id) });
      }
      // One movement per unit (two lines for one variant add up), from the
      // scan log: matched lines by line, extras by product/variant.
      const byKey = new Map();
      const bump = (productId, variantId, qty) => {
        const n = Math.max(0, Math.trunc(Number(qty) || 0));
        if (!n || !productId) return;
        const k = scanKey(productId, variantId);
        const cur = byKey.get(k) || { productId: String(productId), variantId: variantId ? String(variantId) : null, qty: 0 };
        cur.qty += n;
        byKey.set(k, cur);
      };
      for (const l of live) bump(l.product_id, l.variant_id, l.received_qty);
      const exclude = new Set((excludeExtras || []).map(String));
      const { rows: extras } = await client.query(
        `SELECT product_id, variant_id, SUM(qty)::int AS qty
           FROM goods_receipt_scans
          WHERE receipt_id = $1 AND receipt_line_id IS NULL AND product_id IS NOT NULL
          GROUP BY product_id, variant_id`, [receipt.id]
      );
      for (const x of extras) {
        if (!exclude.has(scanKey(x.product_id, x.variant_id))) bump(x.product_id, x.variant_id, x.qty);
      }
      const adjustments = [...byKey.values()].map(a => ({ ...a, mode: 'increment' }));
      const note = receipt.reference ? `${receipt.supplier_name} · ${receipt.reference}` : receipt.supplier_name;
      let batchId = null;
      if (adjustments.length) {
        // No line cap: a receipt carries up to MAX_LINES lines plus its
        // extras, and the batch cap exists for the HTTP count (review).
        ({ batchId } = await Inventory.applyBatch(adjustments, {
          userId, reason: 'receipt', note, goodsReceiptId: receipt.id, maxLines: null,
        }, client));
      }
      await client.query(
        `UPDATE goods_receipts SET status = 'finalized', finalized_by = $2, finalized_at = NOW() WHERE id = $1`,
        [receipt.id, userId ? String(userId) : null]
      );
      await client.query('COMMIT');
      return { batchId, units: adjustments.reduce((s, a) => s + a.qty, 0), lines: adjustments.length };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  },

  // The stock rows a receipt wrote (its audit trail).
  async adjustments(receiptId) {
    const { rows } = await db.query(
      `SELECT a.id, a.product_id, a.product_variant_id, a.previous_stock, a.new_stock, a.delta,
              a.reason, a.batch_id, a.created_at
         FROM inventory_adjustments a
        WHERE a.goods_receipt_id = $1
        ORDER BY a.created_at, a.id`,
      [String(receiptId)]
    );
    return rows;
  },

  // ── internals (caller's transaction) ────────────────────────────────────────

  async _lockDraft(client, receiptId) {
    const { rows } = await client.query(
      `SELECT * FROM goods_receipts WHERE id = $1 FOR UPDATE`, [String(receiptId)]
    );
    const receipt = rows[0];
    if (!receipt) throw typed('Receipt not found', 'RECEIPT_NOT_FOUND', 404);
    if (receipt.status === 'finalized') throw typed('Already finalised', 'ALREADY_FINALIZED', 409);
    if (receipt.status !== 'draft') throw typed('Receipt is closed', 'RECEIPT_CLOSED', 409);
    return receipt;
  },

  async _lineFor(client, receiptId, productId, variantId) {
    const { rows } = await client.query(
      `SELECT id FROM goods_receipt_lines
        WHERE receipt_id = $1 AND product_id = $2
          AND variant_id IS NOT DISTINCT FROM $3
          AND match_status NOT IN ('skipped', 'new_product', 'unmatched')
        ORDER BY sort_order ASC, id ASC LIMIT 1`,
      [String(receiptId), String(productId), variantId ? String(variantId) : null]
    );
    return rows[0] ? rows[0].id : null;
  },

  // Point every scan of the receipt at its line as the lines stand now (a line
  // imported, re-matched or skipped after the scans came in), then re-derive
  // received_qty for every line.
  async _reattachScans(client, receiptId) {
    await client.query(
      `UPDATE goods_receipt_scans s
          SET receipt_line_id = (
            SELECT l.id FROM goods_receipt_lines l
             WHERE l.receipt_id = s.receipt_id AND l.product_id = s.product_id
               AND l.variant_id IS NOT DISTINCT FROM s.variant_id
               AND l.match_status NOT IN ('skipped', 'new_product', 'unmatched')
             ORDER BY l.sort_order ASC, l.id ASC LIMIT 1)
        WHERE s.receipt_id = $1`,
      [String(receiptId)]
    );
    await client.query(
      `UPDATE goods_receipt_lines l
          SET received_qty = COALESCE((SELECT SUM(s.qty) FROM goods_receipt_scans s WHERE s.receipt_line_id = l.id), 0)
        WHERE l.receipt_id = $1`,
      [String(receiptId)]
    );
  },

  async _recomputeLine(client, lineId) {
    await client.query(
      `UPDATE goods_receipt_lines
          SET received_qty = COALESCE((SELECT SUM(qty) FROM goods_receipt_scans WHERE receipt_line_id = $1), 0)
        WHERE id = $1`,
      [String(lineId)]
    );
  },
};

module.exports = GoodsReceipt;
