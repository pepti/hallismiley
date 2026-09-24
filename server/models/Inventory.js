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

function hasVariantAxes(p) {
  if (Array.isArray(p.variant_axes)) return p.variant_axes.length > 0;
  return Boolean(p.variant_axes) && p.variant_axes !== '[]';
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
  static async applyLines(client, lines, { userId = null, orderId = null } = {}) {
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
    for (const line of sorted) {
      const table = line.variantId ? 'product_variants' : 'products';
      const id    = line.variantId || line.productId;
      const { rows: cur } = await client.query(
        `SELECT stock FROM ${table} WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!cur[0]) { const e = new Error('Adjustment line not found'); e.code = 'LINE_NOT_FOUND'; throw e; }
      const previous = Number(cur[0].stock);
      const next = line.mode === 'set'       ? line.qty
                 : line.mode === 'increment' ? previous + line.qty
                 : previous - line.qty;
      if (next < 0) throw insufficient(line, previous);

      await client.query(`UPDATE ${table} SET stock = $1 WHERE id = $2`, [next, id]);

      const reason = line.reason
        || (line.mode === 'increment' ? 'receive' : line.mode === 'decrement' ? 'remove' : 'recount');
      const { rows: adj } = await client.query(
        `INSERT INTO inventory_adjustments
           (product_id, product_variant_id, previous_stock, new_stock, delta, reason, note, user_id, order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [line.productId, line.variantId, previous, next, next - previous, reason, line.note,
         userId || null, orderId || null]
      );
      results[line.i] = {
        productId: line.productId, variantId: line.variantId,
        previous, stock: next, delta: next - previous, adjustmentId: adj[0].id,
      };
    }
    return results;
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

module.exports = Inventory;
