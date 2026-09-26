// Inventory — the three-number stock model (harvested from icelandicstore,
// harvest-ice-c-2026-09-24; ENHANCEMENTS #23).
//
//   On hand   = products.stock / product_variants.stock: what is physically in
//               the building. Moves on admin corrections, the product import,
//               MCP set_stock and — through this module — order fulfilment.
//   Committed = DERIVED, never stored: the quantities on PAID orders whose
//               stock has not moved yet (orders.stock_deducted_at IS NULL). A
//               pending order is an open Stripe session that may never be paid,
//               so it commits nothing; a cancelled / failed / refunded order
//               commits nothing either. Bookable services (no variant) never
//               count — their availability is the scheduling flow's business.
//   Available = On hand − Committed.
//
// ENGINE DIFFERENCE FROM ICE: the engine keeps CHECK (stock >= 0) and does not
// oversell (Halli 2026-09-24). So a decrement that would take on hand below
// zero is refused here with a typed error (INSUFFICIENT_STOCK → 409) instead
// of reaching the CHECK as a 500, and the Stripe webhook refuses a payment
// that would push Available below zero (availabilityShortfalls, under the
// row locks) — refunding it, as the engine always did when it lost a race.
//
// Every change of on hand goes through applyLines (or setAbsolute, which calls
// it), so each movement lands in inventory_adjustments with the actor, the
// reason and — for fulfil / unfulfil — the order. Opening stock on a new
// product or variant is recorded too (reason 'opening'). Fulfilment deducts
// ONCE per order: Order.setOrderStatuses stamps orders.stock_deducted_at in the
// same transaction as the decrement, and un-fulfilling reverses both.
//
// LOCK ORDER (deadlock avoidance — every transaction touching these rows takes
// them in this sequence): the orders row → parent products rows (FOR KEY SHARE,
// sorted) → product_variants rows → products rows, each group sorted by id.
// Three entry points, one order: applyLines (moves stock), lockReferences (only
// REFERENCES these rows — an insert's foreign keys share-lock them) and
// lockForWrite (writes or reads-to-decide without moving stock). A caller makes
// exactly ONE applyLines call per transaction: sorting happens within a call.
// Postgres still has the last word — a status-less 40P01 becomes a retryable
// 409 BUSY in middleware/errorHandler.js.
const crypto = require('crypto');
const db = require('../config/database');

// The predicate every committed computation shares. `o` is the orders alias.
const OPEN_ORDER_SQL = `o.stock_deducted_at IS NULL
            AND o.status NOT IN ('pending', 'cancelled', 'failed', 'refunded')`;

// A line that holds stock: not a bookable service sold at product level.
// `p` is the products alias joined on the line's product_id.
const STOCKED_LINE_SQL = `NOT (p.is_bookable AND oi.product_variant_id IS NULL)`;

// CTE bodies: the open order lines plus their per-product and per-variant sums.
// Use as `WITH ${COMMITTED_CTES} SELECT …`. committed_p sums EVERY line of a
// product, variant lines included, which is what pairs with the product-level
// on-hand rollup (summed active-variant stock).
function committedCtes(extraWhere = '') {
  return `open_lines AS (
         SELECT oi.order_id, oi.product_id, oi.product_variant_id, oi.quantity
           FROM order_items oi
           JOIN orders o   ON o.id = oi.order_id
           JOIN products p ON p.id = oi.product_id
          WHERE ${OPEN_ORDER_SQL}
            AND ${STOCKED_LINE_SQL}${extraWhere}
       ), committed_p AS (
         SELECT product_id, SUM(quantity)::int AS committed
           FROM open_lines
          GROUP BY product_id
       ), committed_v AS (
         SELECT product_variant_id, SUM(quantity)::int AS committed
           FROM open_lines
          WHERE product_variant_id IS NOT NULL
          GROUP BY product_variant_id
       )`;
}
const COMMITTED_CTES = committedCtes();

// Reasons an admin (or MCP) may give for a manual movement. System reasons —
// fulfil, unfulfil, import, opening, and applyLines' mode defaults (receive,
// remove, recount) — are written by code, never chosen.
const ADJUSTMENT_REASONS = ['correction', 'recount', 'received', 'damaged', 'returned', 'theft_loss', 'other'];

// Batches (applyBatch): the movements a line may ask for, the largest batch
// one request may carry, and the largest count a line may name (the same
// ceiling ice validates "Fix stock" against, #15).
const BATCH_MODES = ['increment', 'decrement', 'set'];
const BATCH_MAX_LINES = 500;
const MAX_STOCK_VALUE = 100000000;

// A whole count 0..MAX_STOCK_VALUE from a JSON body: a real number or a
// numeric string only. Number() alone would wave booleans and arrays through
// (true → 1, [] → 0) — ice #15.
function isWholeCount(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_STOCK_VALUE;
}

function hasVariantAxes(p) {
  if (Array.isArray(p.variant_axes)) return p.variant_axes.length > 0;
  return Boolean(p.variant_axes) && p.variant_axes !== '[]';
}

// One refusal for a whole batch (applyLines with collectShortfalls /
// refuseVariantParents): every refused line, in the caller's order, plus the
// single-line fields the INSUFFICIENT_STOCK responder reads.
function batchRefused(lines) {
  const sorted = lines.slice().sort((a, b) => a.index - b.index);
  const first = sorted[0];
  const e = new Error('Stock batch refused');
  e.code = 'BATCH_REFUSED';
  e.status = 409;
  e.lines = sorted;
  e.productId = first.productId; e.variantId = first.variantId;
  e.onHand = first.onHand; e.wanted = first.qty;
  return e;
}

function insufficient(line, previous) {
  const e = new Error('Not enough on hand for that movement');
  e.code = 'INSUFFICIENT_STOCK';
  e.status = 409;
  e.productId = line.productId;
  e.variantId = line.variantId;
  e.onHand = previous;
  e.wanted = line.qty;
  return e;
}

class Inventory {
  // Committed quantities for a set of products and/or variants, in one query.
  // Returns { byProduct: Map<id, qty>, byVariant: Map<id, qty> }; ids with no
  // open lines are simply absent (read them as 0). `excludeOrderId` leaves one
  // order out — the webhook asks "what do the OTHER paid orders hold".
  static async committedMaps({ productIds = [], variantIds = [], excludeOrderId = null } = {}, client = null) {
    const byProduct = new Map();
    const byVariant = new Map();
    const pids = [...new Set(productIds.filter(Boolean).map(String))];
    const vids = [...new Set(variantIds.filter(Boolean).map(String))];
    if (!pids.length && !vids.length) return { byProduct, byVariant };
    const runner = client || db;
    const ctes = excludeOrderId ? committedCtes(' AND o.id <> $3') : COMMITTED_CTES;
    const params = [pids, vids];
    if (excludeOrderId) params.push(String(excludeOrderId));
    const { rows } = await runner.query(
      `WITH ${ctes}
       SELECT 'p' AS kind, product_id AS id, committed FROM committed_p
        WHERE product_id = ANY($1::text[])
       UNION ALL
       SELECT 'v' AS kind, product_variant_id AS id, committed FROM committed_v
        WHERE product_variant_id = ANY($2::text[])`,
      params
    );
    for (const r of rows) (r.kind === 'p' ? byProduct : byVariant).set(r.id, Number(r.committed) || 0);
    return { byProduct, byVariant };
  }

  // Attach on_hand / committed / available to product rows (and to each row's
  // `variants[]`, when present). Product-level on hand is the summed stock of
  // the active variants for a variant product, else the scalar `stock`.
  // Mutates + returns the input (array or single object).
  static async decorate(products, client = null) {
    const list = Array.isArray(products) ? products : (products ? [products] : []);
    if (!list.length) return products;
    const productIds = list.map(p => p.id);
    const variantIds = [];
    for (const p of list) {
      if (Array.isArray(p.variants)) for (const v of p.variants) variantIds.push(v.id);
    }
    const { byProduct, byVariant } = await Inventory.committedMaps({ productIds, variantIds }, client);
    for (const p of list) {
      const variants = Array.isArray(p.variants) ? p.variants : null;
      if (variants) {
        for (const v of variants) {
          const onHand = Number(v.stock) || 0;
          const committed = byVariant.get(String(v.id)) || 0;
          v.on_hand = onHand;
          v.committed = committed;
          v.available = onHand - committed;
        }
      }
      const onHand = (variants && hasVariantAxes(p))
        ? variants.filter(v => v.active !== false).reduce((s, v) => s + (Number(v.stock) || 0), 0)
        : Number(p.stock) || 0;
      const committed = byProduct.get(String(p.id)) || 0;
      p.on_hand = onHand;
      p.committed = committed;
      p.available = onHand - committed;
    }
    return products;
  }

  // For lines [{ productId, variantId?, qty }], the ones Available cannot cover:
  // [{ productId, variantId, wanted, available }]. Read on the caller's client
  // (after lockForWrite, when the answer must hold until commit). Bookable
  // product-level lines are skipped — services are not stock-limited.
  static async availabilityShortfalls(client, lines, { excludeOrderId = null } = {}) {
    const runner = client || db;
    const want = new Map();
    for (const l of lines || []) {
      const key = l.variantId ? `v:${l.variantId}` : `p:${l.productId}`;
      const cur = want.get(key) || { productId: String(l.productId), variantId: l.variantId ? String(l.variantId) : null, wanted: 0 };
      cur.wanted += Math.max(0, Math.trunc(Number(l.qty) || 0));
      want.set(key, cur);
    }
    if (!want.size) return [];
    const entries = [...want.values()];
    const vids = entries.filter(e => e.variantId).map(e => e.variantId);
    const pids = entries.filter(e => !e.variantId).map(e => e.productId);
    const onHand = new Map();
    if (vids.length) {
      const { rows } = await runner.query('SELECT id, stock FROM product_variants WHERE id = ANY($1::text[])', [vids]);
      for (const r of rows) onHand.set(`v:${r.id}`, Number(r.stock) || 0);
    }
    const bookable = new Set();
    if (pids.length) {
      const { rows } = await runner.query('SELECT id, stock, is_bookable FROM products WHERE id = ANY($1::text[])', [pids]);
      for (const r of rows) {
        onHand.set(`p:${r.id}`, Number(r.stock) || 0);
        if (r.is_bookable) bookable.add(`p:${r.id}`);
      }
    }
    const { byProduct, byVariant } = await Inventory.committedMaps(
      { productIds: pids, variantIds: vids, excludeOrderId }, runner
    );
    const out = [];
    for (const e of entries) {
      const key = e.variantId ? `v:${e.variantId}` : `p:${e.productId}`;
      if (bookable.has(key)) continue;
      const committed = e.variantId ? (byVariant.get(e.variantId) || 0) : (byProduct.get(e.productId) || 0);
      const available = (onHand.get(key) || 0) - committed;
      if (e.wanted > available) out.push({ productId: e.productId, variantId: e.variantId, wanted: e.wanted, available });
    }
    return out;
  }

  // Apply stock adjustment lines inside the CALLER'S transaction (`client` is a
  // pool client after BEGIN). Each line: { productId, variantId?, mode, qty,
  // reason?, note? }, mode ∈ increment | decrement | set. Locks each row FOR
  // UPDATE in the module's lock order, writes the new stock and one
  // inventory_adjustments row per line. A decrement below zero throws
  // INSUFFICIENT_STOCK (409) — the engine keeps stock >= 0. Results come back in
  // the caller's line order: { productId, variantId, previous, stock, delta,
  // adjustmentId }. A missing row throws (.code LINE_NOT_FOUND).
  //
  // Batch options (applyBatch, harvest2-lane6a-2026-09-26): `batchId` and
  // `goodsReceiptId` are written on every row; `clientToken` on the FIRST row
  // inserted (its unique index makes a re-sent batch fail whole); with
  // `collectShortfalls` a line that would go below zero is skipped and the
  // call throws ONE BATCH_REFUSED listing every refused line at the end —
  // the caller's transaction must roll back; with `refuseVariantParents` a
  // product-level line on a product that has variant axes is refused the
  // same way (its on hand is the sum of its variants, so a product-level
  // count would move a number nobody reads).
  static async applyLines(client, lines, {
    userId = null, orderId = null,
    batchId = null, goodsReceiptId = null, clientToken = null,
    collectShortfalls = false, refuseVariantParents = false,
  } = {}) {
    if (!Array.isArray(lines) || lines.length === 0) {
      const e = new Error('No adjustments'); e.code = 'NO_ADJUSTMENTS'; throw e;
    }
    const norm = lines.map((line, i) => ({
      i,
      productId: String(line.productId),
      variantId: line.variantId ? String(line.variantId) : null,
      mode:      String(line.mode),
      qty:       Math.max(0, Math.trunc(Number(line.qty) || 0)),
      reason:    line.reason ? String(line.reason) : null,
      note:      (typeof line.note === 'string' && line.note.trim()) ? line.note.trim().slice(0, 500) : null,
    }));
    // Every PARENT products row this call touches, sorted, FOR KEY SHARE before
    // the first FOR UPDATE: the inventory_adjustments insert carries product_id,
    // whose foreign key share-locks the parent. Parents only — a product-level
    // line's own row is taken FOR UPDATE below, and share-then-upgrade is how
    // two fulfilments of one product deadlocked in ice (40P01, 2026-09-20).
    const levelIds = new Set(norm.filter(l => !l.variantId).map(l => l.productId));
    // A product-level line on a product WITH variant axes is refused BEFORE any
    // lock is taken (read without a lock; the check under the row lock below
    // stays as the backstop). Locking first would take that parent FOR UPDATE
    // after its variants — the reverse of the module order, and a cycle with
    // a checkout or a fulfilment on the same product (harvest2-lane6a review).
    if (refuseVariantParents && levelIds.size) {
      const { rows: parents } = await client.query(
        'SELECT id, stock, variant_axes FROM products WHERE id = ANY($1::text[])', [[...levelIds]]
      );
      const early = [];
      for (const p of parents) {
        if (!hasVariantAxes(p)) continue;
        for (const l of norm.filter(x => !x.variantId && x.productId === String(p.id))) {
          early.push({ index: l.i, productId: l.productId, variantId: null, reason: 'VARIANT_REQUIRED',
            onHand: Number(p.stock), mode: l.mode, qty: l.qty, result: null });
        }
      }
      if (early.length) throw batchRefused(early);
    }
    const parentIds = [...new Set(norm.filter(l => l.variantId).map(l => l.productId))]
      .filter(id => !levelIds.has(id)).sort();
    if (parentIds.length) {
      await client.query('SELECT id FROM products WHERE id = ANY($1) ORDER BY id FOR KEY SHARE', [parentIds]);
    }

    // Lock order: variants first, then products, each by id.
    const sorted = norm.slice().sort((a, b) => {
      const ra = a.variantId ? 0 : 1, rb = b.variantId ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return (a.variantId || a.productId).localeCompare(b.variantId || b.productId);
    });
    const results = new Array(norm.length);
    const refused = [];
    let tokenPending = clientToken ? String(clientToken) : null;
    for (const line of sorted) {
      const table = line.variantId ? 'product_variants' : 'products';
      const id    = line.variantId || line.productId;
      // A variant must belong to the product the line names: the audit row
      // carries both, and a mismatch would file the movement under the wrong
      // product's history.
      const { rows: cur } = await client.query(
        line.variantId
          ? `SELECT stock, product_id FROM product_variants WHERE id = $1 FOR UPDATE`
          : `SELECT stock, variant_axes FROM products WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!cur[0] || (line.variantId && String(cur[0].product_id) !== line.productId)) {
        const e = new Error('Adjustment line not found'); e.code = 'LINE_NOT_FOUND';
        e.index = line.i; e.productId = line.productId; e.variantId = line.variantId;
        throw e;
      }
      const previous = Number(cur[0].stock);
      if (refuseVariantParents && !line.variantId && hasVariantAxes(cur[0])) {
        refused.push({ index: line.i, productId: line.productId, variantId: null, reason: 'VARIANT_REQUIRED',
          onHand: previous, mode: line.mode, qty: line.qty, result: null });
        continue;
      }
      const next = line.mode === 'set'       ? line.qty
                 : line.mode === 'increment' ? previous + line.qty
                 : previous - line.qty;
      if (next < 0) {
        if (!collectShortfalls) throw insufficient(line, previous);
        refused.push({ index: line.i, productId: line.productId, variantId: line.variantId, reason: 'NEGATIVE',
          onHand: previous, mode: line.mode, qty: line.qty, result: next });
        continue;
      }
      // Once a line is refused nothing more is written: the batch is going to
      // roll back, and the remaining lines only need checking.
      if (refused.length) continue;

      await client.query(`UPDATE ${table} SET stock = $1 WHERE id = $2`, [next, id]);

      const reason = line.reason
        || (line.mode === 'increment' ? 'receive' : line.mode === 'decrement' ? 'remove' : 'recount');
      const { rows: adj } = await client.query(
        `INSERT INTO inventory_adjustments
           (product_id, product_variant_id, previous_stock, new_stock, delta, reason, note, user_id, order_id,
            batch_id, goods_receipt_id, client_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [line.productId, line.variantId, previous, next, next - previous, reason, line.note,
         userId || null, orderId || null, batchId || null, goodsReceiptId || null, tokenPending]
      );
      tokenPending = null;
      results[line.i] = {
        productId: line.productId, variantId: line.variantId,
        previous, stock: next, delta: next - previous, adjustmentId: adj[0].id,
      };
    }
    if (refused.length) throw batchRefused(refused);
    return results;
  }

  // ── Batches (harvest2-lane6a-2026-09-26) ──────────────────────────────────
  //
  // ONE audited batch of stock movements — a stock count, a goods receipt —
  // all or nothing. Lines: [{ productId, variantId?, mode, qty, reason?,
  // note? }], mode ∈ increment | decrement | set, qty a whole number ≥ 0
  // (≥ 1 for increment/decrement). Every row gets the same batch_id (and the
  // receipt, when there is one). Refusals, in one throw after every line was
  // checked under its lock:
  //   BATCH_INVALID (400)       a malformed line, or one product/variant twice
  //   BATCH_REFUSED (409)       .lines [{ index, reason: NEGATIVE |
  //                             VARIANT_REQUIRED, onHand, mode, qty, result }]
  //   LINE_NOT_FOUND            .index — the caller maps it to a 404
  //   DUPLICATE_BATCH (409)     the clientToken was already used: this batch
  //                             was saved before, nothing moved now
  // Runs in its own transaction, or in the caller's when `client` is given
  // (the receipt finalise holds its receipt row). Either way it is ONE
  // applyLines call, so the module lock order holds, and it runs under a
  // SAVEPOINT: a refused batch is rolled back to it before the error leaves,
  // so a caller that catches the error and commits still commits nothing of
  // the batch. `maxLines` caps the batch (BATCH_MAX_LINES — the HTTP count);
  // a server-built batch such as a receipt passes its own ceiling.
  // → { batchId, results } (results in the caller's line order).
  static async applyBatch(adjustments, {
    userId = null, reason = null, note = null, clientToken = null, goodsReceiptId = null,
    maxLines = BATCH_MAX_LINES,
  } = {}, client = null) {
    const lines = Inventory.normaliseBatch(adjustments, { reason, note, maxLines });
    if (!client) {
      const own = await db.pool.connect();
      try {
        await own.query('BEGIN');
        const out = await Inventory.applyBatch(lines, { userId, clientToken, goodsReceiptId, maxLines }, own);
        await own.query('COMMIT');
        return out;
      } catch (err) {
        try { await own.query('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      } finally {
        own.release();
      }
    }
    const duplicate = () => {
      const e = new Error('This batch was already saved');
      e.code = 'DUPLICATE_BATCH'; e.status = 409;
      return e;
    };
    // A re-sent batch is answered as one before any lock is taken, so the
    // answer is "already saved" even when a line would now be refused. The
    // unique index below stays the guard for two sends racing.
    if (clientToken) {
      const { rows } = await client.query(
        'SELECT 1 FROM inventory_adjustments WHERE client_token = $1 LIMIT 1', [String(clientToken)]
      );
      if (rows.length) throw duplicate();
    }
    const batchId = crypto.randomUUID();
    await client.query('SAVEPOINT inventory_batch');
    try {
      const results = await Inventory.applyLines(client, lines, {
        userId, batchId, goodsReceiptId, clientToken,
        collectShortfalls: true, refuseVariantParents: true,
      });
      await client.query('RELEASE SAVEPOINT inventory_batch');
      return { batchId, results };
    } catch (err) {
      try { await client.query('ROLLBACK TO SAVEPOINT inventory_batch'); } catch { /* the transaction is gone */ }
      if (err && err.code === '23505' && err.constraint === 'uq_inventory_adjustments_client_token') throw duplicate();
      throw err;
    }
  }

  // Validate and normalise batch lines; throws BATCH_INVALID (400) with
  // `.index` on the first bad line. A product or variant named twice is
  // refused rather than merged: two 'set' lines for one shelf are a
  // contradiction, and merging them would hide it.
  static normaliseBatch(adjustments, { reason = null, note = null, maxLines = BATCH_MAX_LINES } = {}) {
    const bad = (index, why) => {
      const e = new Error(`Invalid batch line ${index}: ${why}`);
      e.code = 'BATCH_INVALID'; e.status = 400; e.index = index; e.why = why;
      return e;
    };
    if (!Array.isArray(adjustments) || adjustments.length === 0) throw bad(-1, 'empty');
    if (maxLines != null && adjustments.length > maxLines) throw bad(-1, 'tooMany');
    const seen = new Set();
    const cleanNote = (v) => ((typeof v === 'string' && v.trim()) ? v.trim().slice(0, 500) : null);
    return adjustments.map((a, i) => {
      const productId = a && a.productId != null ? String(a.productId).trim() : '';
      const variantId = a && a.variantId ? String(a.variantId).trim() : null;
      const mode = a && String(a.mode);
      if (!productId) throw bad(i, 'productId');
      if (!BATCH_MODES.includes(mode)) throw bad(i, 'mode');
      if (!isWholeCount(a.qty)) throw bad(i, 'qty');
      const qty = Number(a.qty);
      if (mode !== 'set' && qty < 1) throw bad(i, 'qty');
      const key = variantId ? `v:${variantId}` : `p:${productId}`;
      if (seen.has(key)) throw bad(i, 'duplicate');
      seen.add(key);
      return {
        productId, variantId, mode, qty,
        reason: (a.reason && String(a.reason)) || reason || null,
        note: cleanNote(a.note) || cleanNote(note),
      };
    });
  }

  // "Fix stock" (Inventory Watch, ice #13): move ONE product or variant to an
  // absolute count in its own transaction. The current figure is read under
  // the row locks — the parent FOR KEY SHARE, then the row FOR UPDATE, the
  // module order — and handed to setAbsolute, so the delta is against the
  // value actually being overwritten, never a figure the page loaded earlier.
  // → { previous, stock, delta, adjustmentId } (adjustmentId null when the
  // count already matched), or throws LINE_NOT_FOUND / BATCH_REFUSED
  // (VARIANT_REQUIRED) like a batch would.
  static async correct({ productId, variantId = null, target, reason = 'correction', note = null, userId = null }) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      let previous;
      if (variantId) {
        await client.query('SELECT 1 FROM products WHERE id = $1 FOR KEY SHARE', [String(productId)]);
        const { rows } = await client.query(
          'SELECT stock, product_id FROM product_variants WHERE id = $1 FOR UPDATE', [String(variantId)]
        );
        if (!rows[0] || String(rows[0].product_id) !== String(productId)) {
          const e = new Error('Adjustment line not found'); e.code = 'LINE_NOT_FOUND'; throw e;
        }
        previous = Number(rows[0].stock);
      } else {
        const { rows } = await client.query(
          'SELECT stock, variant_axes FROM products WHERE id = $1 FOR UPDATE', [String(productId)]
        );
        if (!rows[0]) { const e = new Error('Adjustment line not found'); e.code = 'LINE_NOT_FOUND'; throw e; }
        if (hasVariantAxes(rows[0])) {
          const e = new Error('Stock batch refused'); e.code = 'BATCH_REFUSED'; e.status = 409;
          e.lines = [{ index: 0, productId: String(productId), variantId: null, reason: 'VARIANT_REQUIRED',
            onHand: Number(rows[0].stock), mode: 'set', qty: Number(target), result: null }];
          throw e;
        }
        previous = Number(rows[0].stock);
      }
      const result = await Inventory.setAbsolute(client, {
        productId, variantId, previous, target, reason, note, userId,
      });
      await client.query('COMMIT');
      if (!result) return { previous, stock: previous, delta: 0, adjustmentId: null };
      return { previous: result.previous, stock: result.stock, delta: result.delta, adjustmentId: result.adjustmentId };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Inventory Watch + the count screens (read) ────────────────────────────

  // One row per stocked unit: every active product WITHOUT variant axes, and
  // every active variant of an active product WITH them. Bookable services
  // are left out (they hold no stock). units_window = units on the order lines
  // of paid orders (status not pending/cancelled/failed/refunded — the same
  // predicate the committed figure uses) created inside the window;
  // committed is the per-product or per-variant committed figure.
  static async watchRows({ windowDays = 90 } = {}) {
    const days = Math.max(1, Math.min(3650, Math.trunc(Number(windowDays) || 90)));
    const { rows } = await db.query(
      `WITH ${COMMITTED_CTES}, sold AS (
         SELECT oi.product_id, oi.product_variant_id, SUM(oi.quantity)::int AS units
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE o.status NOT IN ('pending', 'cancelled', 'failed', 'refunded')
            AND o.created_at >= NOW() - ($1::int * INTERVAL '1 day')
          GROUP BY oi.product_id, oi.product_variant_id
       ), sold_p AS (
         SELECT product_id, SUM(units)::int AS units FROM sold GROUP BY product_id
       )
       SELECT p.id AS product_id, NULL::text AS variant_id, p.name, NULL::jsonb AS attributes,
              p.sku, p.bin, p.active, p.stock AS on_hand,
              COALESCE(cp.committed, 0) AS committed, COALESCE(sp.units, 0) AS units_window
         FROM products p
         LEFT JOIN committed_p cp ON cp.product_id = p.id
         LEFT JOIN sold_p sp      ON sp.product_id = p.id
        WHERE p.active = TRUE AND p.is_bookable IS NOT TRUE
          AND (p.variant_axes IS NULL OR p.variant_axes = '[]'::jsonb)
       UNION ALL
       SELECT p.id, v.id, p.name, v.attributes,
              COALESCE(v.sku, p.sku), COALESCE(v.bin, p.bin), v.active, v.stock,
              COALESCE(cv.committed, 0), COALESCE(sv.units, 0)
         FROM product_variants v
         JOIN products p          ON p.id = v.product_id
         LEFT JOIN committed_v cv ON cv.product_variant_id = v.id
         LEFT JOIN sold sv        ON sv.product_variant_id = v.id
        WHERE p.active = TRUE AND v.active = TRUE AND p.is_bookable IS NOT TRUE
          AND p.variant_axes IS NOT NULL AND p.variant_axes <> '[]'::jsonb
        ORDER BY name, variant_id NULLS FIRST`,
      [days]
    );
    return rows;
  }

  // Stock rows for the count / receiving screens: the same unit shape as the
  // watch rows (on_hand, committed, available), for the given refs. Refs:
  // [{ productId, variantId? }]. Product-level refs on a product with variant
  // axes come back with `variant_required: true`.
  static async stockItems(refs) {
    const list = (refs || []).filter(r => r && r.productId);
    if (!list.length) return [];
    const vids = [...new Set(list.filter(r => r.variantId).map(r => String(r.variantId)))];
    const pids = [...new Set(list.filter(r => !r.variantId).map(r => String(r.productId)))];
    const out = new Map();
    if (vids.length) {
      const { rows } = await db.query(
        `SELECT p.id AS product_id, v.id AS variant_id, p.name, v.attributes,
                COALESCE(v.sku, p.sku) AS sku, COALESCE(v.barcode, p.barcode) AS barcode,
                COALESCE(v.bin, p.bin) AS bin, v.stock, (p.active AND v.active) AS active
           FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE v.id = ANY($1::text[])`, [vids]
      );
      for (const r of rows) out.set(`v:${r.variant_id}`, r);
    }
    if (pids.length) {
      const { rows } = await db.query(
        `SELECT id AS product_id, NULL::text AS variant_id, name, NULL::jsonb AS attributes,
                sku, barcode, bin, stock, active, variant_axes
           FROM products WHERE id = ANY($1::text[])`, [pids]
      );
      for (const r of rows) out.set(`p:${r.product_id}`, r);
    }
    const { byProduct, byVariant } = await Inventory.committedMaps({ productIds: pids, variantIds: vids });
    return list.map((ref) => {
      const key = ref.variantId ? `v:${ref.variantId}` : `p:${ref.productId}`;
      const r = out.get(key);
      if (!r) return null;
      if (ref.variantId && String(r.product_id) !== String(ref.productId)) return null;
      const onHand = Number(r.stock) || 0;
      const committed = ref.variantId ? (byVariant.get(String(ref.variantId)) || 0) : (byProduct.get(String(ref.productId)) || 0);
      return {
        product_id: r.product_id, variant_id: r.variant_id || null, name: r.name,
        attributes: r.attributes || null, sku: r.sku || null, barcode: r.barcode || null, bin: r.bin || null,
        active: Boolean(r.active), on_hand: onHand, committed, available: onHand - committed,
        variant_required: !ref.variantId && hasVariantAxes(r),
      };
    }).filter(Boolean);
  }

  // The variants of a product (for "which size?" when a product-level code on
  // a variant product was scanned). Active variants only.
  static async variantRefs(productId) {
    const { rows } = await db.query(
      `SELECT product_id, id AS variant_id FROM product_variants
        WHERE product_id = $1 AND active = TRUE ORDER BY sku ASC, id`,
      [String(productId)]
    );
    return rows.map(r => ({ productId: r.product_id, variantId: r.variant_id }));
  }

  // Search by name, SKU, barcode or bin for the count screen's picker: stocked
  // units only (never a variant product's own row), active or not, capped.
  static async searchItems(q, { limit = 20 } = {}) {
    const term = String(q || '').trim();
    if (!term) return [];
    const like = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const n = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 20)));
    const { rows } = await db.query(
      `SELECT * FROM (
         SELECT p.id AS product_id, NULL::text AS variant_id, p.name
           FROM products p
          WHERE p.is_bookable IS NOT TRUE
            AND (p.variant_axes IS NULL OR p.variant_axes = '[]'::jsonb)
            AND (p.name ILIKE $1 OR p.sku ILIKE $1 OR p.barcode ILIKE $1 OR p.bin ILIKE $1)
         UNION ALL
         SELECT v.product_id, v.id, p.name
           FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE p.is_bookable IS NOT TRUE
            AND (p.name ILIKE $1 OR v.sku ILIKE $1 OR v.barcode ILIKE $1 OR v.bin ILIKE $1
                 OR v.attributes::text ILIKE $1)
       ) hits
       ORDER BY name, variant_id NULLS FIRST
       LIMIT $2`,
      [like, n]
    );
    return Inventory.stockItems(rows.map(r => ({ productId: r.product_id, variantId: r.variant_id })));
  }

  // FOR KEY SHARE on every row a batch of inserts is about to REFERENCE, in the
  // module lock order, inside the caller's transaction — so an order's line
  // inserts (whose foreign keys share-lock their product / variant in CART
  // order) cannot cycle with a fulfilment's sorted FOR UPDATE. Call it BEFORE
  // the first insert. refs: [{ productId, variantId? }].
  static async lockReferences(client, refs) {
    const byId = (a, b) => a.localeCompare(b);
    const uniq = ids => [...new Set(ids.filter(Boolean).map(String))].sort(byId);
    const list = refs || [];
    const variantIds = uniq(list.map(r => r.variantId));
    const parentIds  = uniq(list.filter(r => r.variantId).map(r => r.productId));
    const levelIds   = uniq(list.filter(r => !r.variantId).map(r => r.productId))
      .filter(id => !parentIds.includes(id));
    for (const id of parentIds) {
      await client.query('SELECT 1 FROM products WHERE id = $1 FOR KEY SHARE', [id]);
    }
    for (const id of variantIds) {
      await client.query('SELECT 1 FROM product_variants WHERE id = $1 FOR KEY SHARE', [id]);
    }
    for (const id of levelIds) {
      await client.query('SELECT 1 FROM products WHERE id = $1 FOR KEY SHARE', [id]);
    }
  }

  // Lock a set of products and variants a transaction is about to WRITE (or to
  // decide on) without moving stock, in the module lock order: products that
  // HAVE variants (parents) → variants → products without. FOR NO KEY UPDATE:
  // it does not conflict with an order line's FOR KEY SHARE, but does with
  // applyLines and with another lockForWrite. Call it once, before the first
  // write.
  static async lockForWrite(client, { productIds = [], variantIds = [] } = {}) {
    const byId = (a, b) => a.localeCompare(b);
    const uniq = ids => [...new Set((ids || []).filter(Boolean).map(String))].sort(byId);
    const pids = uniq(productIds), vids = uniq(variantIds);
    let parents = new Set();
    if (pids.length) {
      const { rows } = await client.query(
        'SELECT DISTINCT product_id FROM product_variants WHERE product_id = ANY($1::text[])', [pids]
      );
      parents = new Set(rows.map(r => String(r.product_id)));
    }
    for (const id of pids.filter(p => parents.has(p))) {
      await client.query('SELECT 1 FROM products WHERE id = $1 FOR NO KEY UPDATE', [id]);
    }
    for (const id of vids) {
      await client.query('SELECT 1 FROM product_variants WHERE id = $1 FOR NO KEY UPDATE', [id]);
    }
    for (const id of pids.filter(p => !parents.has(p))) {
      await client.query('SELECT 1 FROM products WHERE id = $1 FOR NO KEY UPDATE', [id]);
    }
  }

  // Move ONE row's on hand to an ABSOLUTE target, inside the caller's
  // transaction ("the admin typed 42"). Expressed as a delta so the audit row
  // says what moved. A target that is not a whole number ≥ 0 moves nothing
  // rather than writing a zero-delta row. Returns the applyLines result, or
  // null when nothing moved. Counts as the caller's ONE applyLines call.
  static async setAbsolute(client, {
    productId, variantId = null, previous, target,
    reason = 'correction', note = null, userId = null,
  } = {}) {
    const next = Math.trunc(Number(target));
    const prev = Math.trunc(Number(previous));
    if (!Number.isFinite(next) || !Number.isFinite(prev) || next === prev || next < 0) return null;
    const [result] = await Inventory.applyLines(client, [{
      productId: String(productId),
      variantId: variantId ? String(variantId) : null,
      mode: next > prev ? 'increment' : 'decrement',
      qty:  Math.abs(next - prev),
      reason, note,
    }], { userId });
    return result;
  }

  // Opening stock of a row that was just INSERTed with `stock` already in it:
  // the creation is the event, so there is no movement to apply — only the
  // audit row (previous 0 → stock, reason 'opening'). Caller's client.
  static async recordOpening(client, { productId, variantId = null, stock, userId = null, note = null }) {
    const n = Math.trunc(Number(stock) || 0);
    if (n <= 0) return null;
    const { rows } = await (client || db).query(
      `INSERT INTO inventory_adjustments
         (product_id, product_variant_id, previous_stock, new_stock, delta, reason, note, user_id)
       VALUES ($1, $2, 0, $3, $3, 'opening', $4, $5) RETURNING id`,
      [String(productId), variantId ? String(variantId) : null, n, note, userId || null]
    );
    return rows[0].id;
  }

  // The stock lines of an order (bookable services at product level hold no
  // stock and are skipped). Read on the caller's client.
  static async linesForOrder(client, orderId) {
    const { rows } = await client.query(
      `SELECT oi.product_id, oi.product_variant_id, oi.quantity
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1 AND ${STOCKED_LINE_SQL}
        ORDER BY oi.created_at ASC, oi.id ASC`,
      [String(orderId)]
    );
    return rows;
  }

  // Move an order's lines out of (direction 'deduct', reason 'fulfil') or back
  // into (direction 'restore', reason 'unfulfil') on hand. Called by
  // Order.setOrderStatuses inside its transaction, after it has locked the
  // orders row — never on its own. Returns [] for an order with no stock lines.
  static async moveForOrder(client, orderId, direction, { userId = null } = {}) {
    const lines = await Inventory.linesForOrder(client, orderId);
    if (!lines.length) return [];
    const deduct = direction === 'deduct';
    return Inventory.applyLines(
      client,
      lines.map(l => ({
        productId: l.product_id,
        variantId: l.product_variant_id,
        mode:      deduct ? 'decrement' : 'increment',
        qty:       l.quantity,
        reason:    deduct ? 'fulfil' : 'unfulfil',
      })),
      { userId, orderId }
    );
  }

  // The audit trail of one product (its variants included), newest first, with
  // who moved it and the order it belongs to. Admin product editor.
  static async history(productId, { limit = 50 } = {}) {
    const n = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 50)));
    const { rows } = await db.query(
      `SELECT a.id, a.product_id, a.product_variant_id, a.previous_stock, a.new_stock,
              a.delta, a.reason, a.note, a.created_at,
              u.username AS user_name, o.order_number,
              v.sku AS variant_sku, v.attributes AS variant_attributes
         FROM inventory_adjustments a
         LEFT JOIN users u            ON u.id = a.user_id
         LEFT JOIN orders o           ON o.id = a.order_id
         LEFT JOIN product_variants v ON v.id = a.product_variant_id
        WHERE a.product_id = $1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $2`,
      [String(productId), n]
    );
    return rows;
  }
}

Inventory.OPEN_ORDER_SQL = OPEN_ORDER_SQL;
Inventory.COMMITTED_CTES = COMMITTED_CTES;
Inventory.ADJUSTMENT_REASONS = ADJUSTMENT_REASONS;
Inventory.BATCH_MODES = BATCH_MODES;
Inventory.BATCH_MAX_LINES = BATCH_MAX_LINES;
Inventory.MAX_STOCK_VALUE = MAX_STOCK_VALUE;
Inventory.isWholeCount = isWholeCount;

module.exports = Inventory;
