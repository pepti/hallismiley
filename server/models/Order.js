// Repository pattern for orders + order_items + processed webhook events.
// All money stored as integers in the order's currency's smallest unit.
const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../logger');
const Inventory = require('./Inventory');
const { computeOrderVat, isExport, countryOf } = require('../utils/orderVat');

const COLUMNS = `id, order_number, user_id, guest_email, guest_name, currency,
  subtotal, shipping, total, status, payment_status, fulfillment_status,
  shipping_method, shipping_address,
  stripe_session_id, stripe_payment_intent_id, paid_at, fulfilled_at, stock_deducted_at, tags,
  created_at, updated_at`;

const ITEM_COLUMNS = `id, order_id, product_id, product_variant_id,
  product_name_snapshot, product_price_snapshot, variant_attributes,
  quantity, currency, created_at`;

function generateOrderNumber() {
  // HP-YYYYMMDD-XXXX — human-readable, doesn't leak sequential order count.
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `HP-${date}-${suffix}`;
}

const PAYMENT_STATES     = ['pending', 'paid', 'refunded', 'partially_refunded', 'voided'];
const FULFILLMENT_STATES = ['unfulfilled', 'fulfilled', 'partial', 'delivered'];

// Map the two independent statuses back onto the legacy single `status` enum so
// existing code/reports that still read `status` stay coherent.
function deriveStatus(payment, fulfillment) {
  if (payment === 'voided') return 'cancelled';
  if (payment === 'refunded' || payment === 'partially_refunded') return 'refunded';
  if (fulfillment === 'fulfilled' || fulfillment === 'delivered') return 'shipped';
  if (payment === 'paid') return 'paid';
  return 'pending';
}

// Named list views (`?view=` on the admin order list and its export; harvest 2
// lane 5, icelandicstore #417). ONE predicate per view, which the "Í dag"
// attention card counts with too (services/adminHome.js) — so the number on
// the card is exactly the rows its link opens. `o` is the orders alias. An
// unknown view is ignored, like an unknown status.
const ORDER_VIEWS = {
  // Paid (or partly refunded) and not yet sent: the orders to fulfil.
  open: `o.payment_status IN ('paid','partially_refunded')
         AND o.fulfillment_status IN ('unfulfilled','partial')`,
};

// WHERE builder shared by listAll + count. B2C: search spans the order number,
// the guest email/name, and the linked user's email.
function buildOrderFilter({ status = null, paymentStatus = null, fulfillmentStatus = null, q = null, view = null } = {}) {
  const params = [];
  const where  = [];
  if (view && Object.prototype.hasOwnProperty.call(ORDER_VIEWS, view)) where.push(`(${ORDER_VIEWS[view]})`);
  if (status) { params.push(String(status)); where.push(`o.status = $${params.length}`); }
  if (paymentStatus && PAYMENT_STATES.includes(paymentStatus)) {
    params.push(paymentStatus); where.push(`o.payment_status = $${params.length}`);
  }
  if (fulfillmentStatus && FULFILLMENT_STATES.includes(fulfillmentStatus)) {
    params.push(fulfillmentStatus); where.push(`o.fulfillment_status = $${params.length}`);
  }
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim()}%`);
    const p = `$${params.length}`;
    where.push(`(o.order_number ILIKE ${p} OR o.guest_email ILIKE ${p} OR o.guest_name ILIKE ${p} OR u.email ILIKE ${p})`);
  }
  return { clause: where.length ? where.join(' AND ') : 'TRUE', params };
}

// The customer's order note, as stored (migration 115; ported from
// icelandicstore #213): plain text, trimmed, at most ORDER_NOTE_MAX characters
// (a longer paste is cut, not refused — the note is a courtesy, never a reason
// to lose the order). Anything that is not a non-blank string is no note.
// Rendered escaped, staff-only (the admin order page); never in COLUMNS.
const ORDER_NOTE_MAX = 1000;
function normaliseNote(raw) {
  if (typeof raw !== 'string') return null;
  // Cut by code point, not UTF-16 unit, so an emoji at the cut is not split
  // into a lone surrogate.
  const note = Array.from(raw.trim()).slice(0, ORDER_NOTE_MAX).join('').trim();
  return note || null;
}

// ── VAT snapshot (migration 121; harvest 2 lane 5, 2026-09-26) ───────────────
// Written once, inside the checkout transaction, by createWithItems: each
// line's rate (order_items.vat_rate) and the VAT inside the total
// (orders.vat_total, the order's own currency's minor units). The rule is
// utils/orderVat.js — the one bookkeeping/invoiceService.buildLines applies —
// fed exactly what the invoice will read: the line rows in (created_at, id)
// order (the largest-remainder discount split breaks ties by position, and
// rows written in one transaction share created_at), the product's rate and
// service flag, the country the invoice will snapshot. So for an ISK order the
// snapshot equals the VAT the invoice later books
// (tests/integration/orderVatSnapshot.test.js) — as long as no product's rate
// changes in between: the invoice reads the CURRENT rate, not this snapshot
// (owed; docs/history.d/2026-09-26-harvest2-lane5-reports.md).
//
// A rate the rule refuses (a product row outside 0/11/24) leaves the snapshot
// NULL and is logged — the sale is not lost over a report figure; the invoice
// refuses the same row loudly when it is issued. Returns vat_total or null.
// `order`: { id, total, shipping (after the shipping discount), shippingAddress }.
async function snapshotVat(client, order) {
  const { rows } = await client.query(
    `SELECT oi.id, oi.product_price_snapshot, oi.quantity, p.vat_rate,
            COALESCE(p.is_bookable, FALSE) AS is_service
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at ASC, oi.id ASC`,
    [order.id]
  );
  let vat;
  try {
    vat = computeOrderVat({
      lines: rows.map(r => ({
        unit: Number(r.product_price_snapshot), quantity: Number(r.quantity),
        vat_rate: r.vat_rate, is_service: r.is_service,
      })),
      shipping: order.shipping,
      total: order.total,
      exportSale: isExport(countryOf(order.shippingAddress)),
    });
  } catch (err) {
    logger.error({ err, orderId: order.id }, 'order VAT snapshot refused; left NULL');
    return null;
  }
  for (let i = 0; i < rows.length; i++) {
    await client.query('UPDATE order_items SET vat_rate = $1 WHERE id = $2', [vat.lines[i].vat_rate, rows[i].id]);
  }
  await client.query('UPDATE orders SET vat_total = $1 WHERE id = $2', [vat.vat_total, order.id]);
  return vat.vat_total;
}

// The sales report's chart resolutions and the clock it cuts them on. Iceland
// keeps UTC all year, but naming the zone keeps a bucket right on a Postgres
// whose session TimeZone is not UTC.
const SALES_BUCKETS = ['hour', 'day', 'week', 'month'];
const STORE_TZ = 'Atlantic/Reykjavik';

// The VAT inside one order row (alias `a`), for the reports: the snapshot, and
// for an order without one (placed by the previous release during a
// self-update swap — invariant 14) the same APPROXIMATION migration 121's
// backfill writes, from the products' current rates. Kept in step with that
// migration by hand; COALESCE evaluates the fallback only for a NULL, so in
// practice it only ever runs for the orders of a swap window.
const EXPORT_SQL = a => `(UPPER(TRIM(COALESCE(NULLIF(${a}.shipping_address->>'country_code', ''),
  NULLIF(${a}.shipping_address->>'country', ''), 'IS'))) NOT IN ('IS', 'ISL', 'ICELAND', 'ÍSLAND'))`;
function vatTotalSql(a = 'o') {
  const ship = `GREATEST(${a}.shipping - COALESCE(${a}.shipping_discount, 0), 0)::numeric`;
  const goods = `(SELECT COALESCE(SUM(gi.product_price_snapshot::numeric * gi.quantity), 0)
                    FROM order_items gi WHERE gi.order_id = ${a}.id)`;
  const f = `COALESCE(GREATEST(${goods} + ${ship} - ${a}.total, 0) / NULLIF(${goods} + ${ship}, 0), 0)`;
  return `COALESCE(${a}.vat_total, ((
      SELECT COALESCE(SUM(ROUND(ai.product_price_snapshot::numeric * ai.quantity * (1 - ${f})
                                * r.rate / (100 + r.rate))), 0)
        FROM order_items ai
        JOIN products ap ON ap.id = ai.product_id
        CROSS JOIN LATERAL (SELECT CASE WHEN ${EXPORT_SQL(a)} AND NOT COALESCE(ap.is_bookable, FALSE) THEN 0
                                        ELSE COALESCE(ai.vat_rate, ap.vat_rate, 24) END AS rate) r
       WHERE ai.order_id = ${a}.id)
    + CASE WHEN ${EXPORT_SQL(a)} THEN 0 ELSE ROUND(${ship} * (1 - ${f}) * 24 / 124) END)::bigint)`;
}

class Order {
  static normaliseNote(raw) { return normaliseNote(raw); }

  // Create order + items in one transaction; computes totals from the passed
  // server-trusted line data. Caller is responsible for having already
  // re-fetched prices from the DB — do NOT trust client prices here either.
  static async createWithItems({
    userId = null,
    guestEmail = null,
    guestName = null,
    currency,
    shippingMethod,
    shippingAddress = null,
    items,       // [{ productId, name, price, quantity }]
    shipping,    // integer minor units
    appliedDiscount = null, // { discount, discountAmount, shippingDiscount } | null
    notes = null,           // the buyer's checkout note (raw; normalised here)
  }) {
    if (!['ISK', 'EUR'].includes(currency)) {
      throw new Error(`Invalid currency: ${currency}`);
    }
    if (!['flat_rate', 'local_pickup'].includes(shippingMethod)) {
      throw new Error(`Invalid shipping method: ${shippingMethod}`);
    }
    if (!items || items.length === 0) {
      throw new Error('Order must contain at least one item');
    }

    const subtotal = items.reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0);
    // Clamp the discount amounts so the order can never go negative.
    const discountAmount   = Math.max(0, Math.min(Number(appliedDiscount?.discountAmount) || 0, subtotal));
    const shippingDiscount = Math.max(0, Math.min(Number(appliedDiscount?.shippingDiscount) || 0, Number(shipping)));
    const total = Math.max(0, subtotal - discountAmount + (Number(shipping) - shippingDiscount));
    const disc  = appliedDiscount?.discount || null;
    const orderNumber = generateOrderNumber();

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (
           order_number, user_id, guest_email, guest_name, currency,
           subtotal, shipping, total, status, shipping_method, shipping_address,
           discount_code, discount_title, discount_amount, shipping_discount, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12, $13, $14, $15)
         RETURNING ${COLUMNS}`,
        [
          orderNumber, userId, guestEmail, guestName, currency,
          subtotal, Number(shipping), total, shippingMethod,
          shippingAddress ? JSON.stringify(shippingAddress) : null,
          disc ? disc.code : null,
          disc ? (disc.title || disc.code) : null,
          discountAmount, shippingDiscount,
          normaliseNote(notes),
        ]
      );
      const order = orderRows[0];

      // Each line insert share-locks its product / variant through the foreign
      // key — in CART order, left to itself. Take them up front in the stock
      // lock order (models/Inventory.js), or a cart listing two rows the other
      // way round from a fulfilment's sorted FOR UPDATE can deadlock with it.
      await Inventory.lockReferences(client, items);
      // A checkout that waited on those locks behind a product merge
      // (services/productMerge/engine.js holds them FOR UPDATE) now finds the
      // product merged away: its lines would land on a hidden row the merge
      // has already emptied. Refused as a 409 the cart can act on.
      const { rows: merged } = await client.query(
        'SELECT id FROM products WHERE id = ANY($1::text[]) AND merged_into_id IS NOT NULL',
        [[...new Set(items.map(it => String(it.productId)))]]
      );
      if (merged.length) {
        const e = new Error('A product in the order was merged into another');
        e.status = 409; e.messageKey = 'errors.shop.productMerged'; e.reason = 'PRODUCT_MERGED';
        throw e;
      }
      for (const it of items) {
        await client.query(
          `INSERT INTO order_items (
             order_id, product_id, product_variant_id,
             product_name_snapshot, product_price_snapshot, variant_attributes,
             quantity, currency
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
          [
            order.id,
            String(it.productId),
            it.variantId ? String(it.variantId) : null,
            String(it.name),
            Number(it.price),
            it.variantAttributes ? JSON.stringify(it.variantAttributes) : null,
            Number(it.quantity),
            currency,
          ]
        );
      }

      // The order's VAT, snapshotted (migration 121; harvest 2 lane 5).
      const vatTotal = await snapshotVat(client, {
        id: order.id, total, shippingAddress,
        shipping: Math.max(0, Number(shipping) - shippingDiscount),
      });
      if (vatTotal !== null) order.vat_total = vatTotal;

      await client.query('COMMIT');
      return order;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async setStripeSession(orderId, stripeSessionId) {
    const { rows } = await db.query(
      `UPDATE orders SET stripe_session_id = $1 WHERE id = $2 RETURNING ${COLUMNS}`,
      [String(stripeSessionId), String(orderId)]
    );
    return rows[0] || null;
  }

  static async findById(id) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM orders WHERE id = $1`,
      [String(id)]
    );
    return rows[0] || null;
  }

  static async findByOrderNumber(orderNumber) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM orders WHERE order_number = $1`,
      [String(orderNumber)]
    );
    return rows[0] || null;
  }

  static async findByStripeSessionId(sessionId) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM orders WHERE stripe_session_id = $1`,
      [String(sessionId)]
    );
    return rows[0] || null;
  }

  static async findByUserId(userId, { limit = 50, offset = 0 } = {}) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM orders
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [String(userId), Number(limit), Number(offset)]
    );
    return rows;
  }

  // Admin order list — filter by legacy status OR the new payment/fulfillment
  // statuses, free-text search, whitelisted sort. Joins the user's email and a
  // per-order item count for the table.
  static async listAll({ status = null, paymentStatus = null, fulfillmentStatus = null,
                         q = null, view = null, sort = 'date', dir = 'desc', limit = 100, offset = 0 } = {}) {
    const { clause, params } = buildOrderFilter({ status, paymentStatus, fulfillmentStatus, q, view });
    const SORT = {
      order:       'o.order_number',
      date:        'o.created_at',
      customer:    "lower(coalesce(u.email, o.guest_email, o.guest_name, ''))",
      total:       'o.total',
      payment:     'o.payment_status',
      fulfillment: 'o.fulfillment_status',
    };
    const col    = SORT[sort] || SORT.date;
    const dirSql = dir === 'asc' ? 'ASC' : 'DESC';
    params.push(Number(limit));  const limIdx = params.length;
    params.push(Number(offset)); const offIdx = params.length;
    const { rows } = await db.query(
      `SELECT o.*, u.email AS user_email,
              COALESCE(it.item_count, 0)::int AS item_count
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN (SELECT order_id, SUM(quantity)::int AS item_count
                      FROM order_items GROUP BY order_id) it ON it.order_id = o.id
        WHERE ${clause}
        ORDER BY ${col} ${dirSql} NULLS LAST, o.created_at DESC
        LIMIT $${limIdx} OFFSET $${offIdx}`,
      params
    );
    return rows;
  }

  static async count({ status = null, paymentStatus = null, fulfillmentStatus = null, q = null, view = null } = {}) {
    const { clause, params } = buildOrderFilter({ status, paymentStatus, fulfillmentStatus, q, view });
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
        WHERE ${clause}`,
      params
    );
    return rows[0].total;
  }

  // Enriched single order for the admin detail view (adds the user's email +
  // their lifetime order count).
  static async findDetailById(id) {
    const { rows } = await db.query(
      `SELECT o.*, u.email AS user_email,
              COALESCE((SELECT COUNT(*)::int FROM orders o2 WHERE o2.user_id = o.user_id), 0) AS user_order_count
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
        WHERE o.id = $1`,
      [String(id)]
    );
    return rows[0] || null;
  }

  // Set payment and/or fulfillment status independently; derives the legacy
  // `status` and maintains paid_at / fulfilled_at timestamps.
  //
  // This is also the ONE place on hand moves for an order (models/Inventory.js,
  // harvested from icelandicstore): entering fulfilled/delivered deducts every
  // stock line and stamps stock_deducted_at in the same transaction; going back
  // to unfulfilled/partial restores it. The orders row is locked FOR UPDATE
  // first (then variants, then products — Inventory's lock order), so two
  // fulfils of one order serialise and the second sees the stamp and moves
  // nothing. Deliberately NOT moved: a fulfilled order later cancelled or
  // refunded keeps its deduction (the goods left — restock by hand), and a
  // cancelled/refunded order marked fulfilled writes the status only. A
  // fulfilment the shelf cannot cover throws INSUFFICIENT_STOCK (409) and
  // changes nothing — the engine keeps stock >= 0. `userId` names the actor on
  // the audit rows.
  static async setOrderStatuses(id, { payment_status, fulfillment_status } = {}, { userId = null } = {}) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: cur } = await client.query(
        `SELECT ${COLUMNS} FROM orders WHERE id = $1 FOR UPDATE`, [String(id)]
      );
      const current = cur[0];
      if (!current) { await client.query('ROLLBACK'); return null; }
      const payment     = payment_status     != null ? payment_status     : current.payment_status;
      const fulfillment = fulfillment_status != null ? fulfillment_status : current.fulfillment_status;
      if (!PAYMENT_STATES.includes(payment))         throw new Error(`Invalid payment_status: ${payment}`);
      if (!FULFILLMENT_STATES.includes(fulfillment)) throw new Error(`Invalid fulfillment_status: ${fulfillment}`);
      const status  = deriveStatus(payment, fulfillment);
      const paidSql = payment === 'paid' ? 'COALESCE(paid_at, NOW())' : payment === 'pending' ? 'NULL' : 'paid_at';
      const fulSql  = (fulfillment === 'fulfilled' || fulfillment === 'delivered') ? 'COALESCE(fulfilled_at, NOW())'
                    : fulfillment === 'unfulfilled' ? 'NULL' : 'fulfilled_at';

      // Inventory: deduct once on the way into fulfilled/delivered, restore on
      // the way back out. The stamp is the idempotency key.
      const closing = fulfillment === 'fulfilled' || fulfillment === 'delivered';
      const opening = fulfillment === 'unfulfilled' || fulfillment === 'partial';
      let deductedSql = 'stock_deducted_at';
      if (closing && !current.stock_deducted_at && !['cancelled', 'refunded'].includes(status)) {
        await Inventory.moveForOrder(client, current.id, 'deduct', { userId });
        deductedSql = 'NOW()';
      } else if (opening && current.stock_deducted_at) {
        await Inventory.moveForOrder(client, current.id, 'restore', { userId });
        deductedSql = 'NULL';
      }

      const { rows } = await client.query(
        `UPDATE orders
            SET payment_status = $1, fulfillment_status = $2, status = $3,
                paid_at = ${paidSql}, fulfilled_at = ${fulSql},
                stock_deducted_at = ${deductedSql}
          WHERE id = $4
        RETURNING ${COLUMNS}`,
        [payment, fulfillment, status, String(id)]
      );
      await client.query('COMMIT');
      return rows[0] || null;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // Replace the order's tags (deduped, trimmed, capped at 50).
  static async updateTags(id, tags) {
    const clean = Array.isArray(tags)
      ? [...new Set(tags.map(s => String(s).trim()).filter(Boolean))].slice(0, 50)
      : [];
    const { rows } = await db.query(
      `UPDATE orders SET tags = $1::jsonb WHERE id = $2 RETURNING ${COLUMNS}`,
      [JSON.stringify(clean), String(id)]
    );
    return rows[0] || null;
  }

  static async updateStatus(id, status, extra = {}) {
    const allowedStatuses = ['pending', 'paid', 'failed', 'shipped', 'cancelled', 'refunded'];
    if (!allowedStatuses.includes(status)) {
      throw new Error(`Invalid order status: ${status}`);
    }
    const sets = [`status = $1`];
    const params = [status];
    if (extra.paidAt !== undefined) {
      params.push(extra.paidAt);
      sets.push(`paid_at = $${params.length}`);
    }
    if (extra.stripePaymentIntentId !== undefined) {
      params.push(extra.stripePaymentIntentId);
      sets.push(`stripe_payment_intent_id = $${params.length}`);
    }
    params.push(String(id));
    const { rows } = await db.query(
      `UPDATE orders SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params
    );
    return rows[0] || null;
  }

  // Atomic transition pending → paid, inside the caller's transaction.
  // Returns the updated row if the transition happened, null if the order
  // was already in a non-pending state (idempotency).
  static async markPaidIfPending(client, orderId, stripePaymentIntentId) {
    const { rows } = await client.query(
      `UPDATE orders
          SET status = 'paid', payment_status = 'paid', paid_at = NOW(), stripe_payment_intent_id = $1
        WHERE id = $2 AND status = 'pending'
      RETURNING ${COLUMNS}`,
      [String(stripePaymentIntentId), String(orderId)]
    );
    return rows[0] || null;
  }

  static async listItems(orderId) {
    // LEFT JOIN products so callers can branch on is_bookable (shop redesign
     // step 5 — services trigger a post-checkout scheduling flow). Snapshot
     // columns on order_items remain the source of truth for name/price;
     // the JOIN is non-authoritative — a deleted product just renders the
     // booking flag as NULL, which we coerce to false at read time.
    // vat_rate is the product's CURRENT rate, the same live read
    // bookkeeping/invoiceService.readOrderForInvoicing books the invoice with,
    // so the admin order page's per-rate VAT (utils/vat.js) matches the
    // invoice. A deleted product reads NULL, which the display treats as the
    // standard rate, as the invoice does.
    const { rows } = await db.query(
      `SELECT ${ITEM_COLUMNS.split(',').map(c => `oi.${c.trim()}`).join(', ')},
              COALESCE(p.is_bookable, FALSE) AS is_bookable,
              p.vat_rate
         FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1
        ORDER BY oi.created_at ASC`,
      [String(orderId)]
    );
    return rows;
  }

  // The order's lines with the LIVE code, shelf and options of what was sold —
  // the delivery note's pick list (ported from icelandicstore #8/#334; harvest
  // 2 lane 6c). The variant's own SKU/bin win over the product's; an archived
  // variant still resolves (by id), so an old order prints its SKU. Staff-only:
  // it carries the shelf.
  static async listItemsWithSku(orderId) {
    const { rows } = await db.query(
      `SELECT ${ITEM_COLUMNS.split(',').map(c => `oi.${c.trim()}`).join(', ')},
              COALESCE(pv.sku, p.sku) AS sku, COALESCE(pv.bin, p.bin) AS bin,
              pv.attributes AS variant_attributes_current, p.variant_axes AS variant_axes
         FROM order_items oi
         LEFT JOIN products p          ON p.id  = oi.product_id
         LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
        WHERE oi.order_id = $1
        ORDER BY oi.created_at ASC, oi.id ASC`,
      [String(orderId)]
    );
    return rows;
  }

  // The admin sales report (AdminSalesView, MCP sales_report). Harvest 2 lane
  // 5, 2026-09-26 — period presets, a comparison window and net sales, ported
  // from icelandicstore #414 onto the engine's own semantics, which it keeps:
  //   * an order counts in the window its PAYMENT falls in (paid_at set,
  //     paid_at in [from, to)) — not when it was created;
  //   * money is per CURRENCY, never summed across ISK and EUR;
  //   * order counts and top products (units) are currency-agnostic.
  // Net sales = total − VAT (vatTotalSql: the migration-121 snapshot, with the
  // backfill's approximation for an order without one). `revenue` stays GROSS.
  //
  // `compare` ({ from, to }) adds the same KPIs for a second window
  // (`kpisPrev`). `bucket` (hour | day | week | month) cuts the series on the
  // shop's clock, Atlantic/Reykjavik, whatever the session TimeZone: an
  // hour key is 'YYYY-MM-DDTHH', a day/week/month key the bucket's first day
  // 'YYYY-MM-DD' (a week starts on Monday). Buckets without sales are simply
  // absent — the client (utils/dateRanges.js fillSeries) draws them as 0.
  //
  // `days` is the previous release's call shape (?days=30, the trailing
  // window) and still answers — with the legacy keys (`days`, `orders`,
  // `revenueByCurrency`, `byDay`, `topProducts`) the old client reads during a
  // self-update swap. Every call returns the legacy keys too.
  static async salesReport({ from = null, to = null, compare = null, bucket = 'day', days = null } = {}) {
    let n = null;
    if (!from && !to) {
      n = Math.min(365, Math.max(1, Math.floor(Number(days) || 30)));
      to = new Date();
      from = new Date(to.getTime() - n * 86400000);
    }
    const unit = SALES_BUCKETS.includes(bucket) ? bucket : 'day';
    const fmt = unit === 'hour' ? `'YYYY-MM-DD"T"HH24'` : `'YYYY-MM-DD'`;
    const local = `(o.paid_at AT TIME ZONE '${STORE_TZ}')`;
    const inWindow = `o.paid_at IS NOT NULL AND o.paid_at >= $1 AND o.paid_at < $2`;
    const vat = vatTotalSql('o');

    const kpiQuery = (lo, hi) => db.query(
      `SELECT o.currency, COUNT(*)::int AS orders,
              COALESCE(SUM(o.total), 0)::bigint AS revenue,
              COALESCE(SUM(${vat}), 0)::bigint AS vat,
              COALESCE(SUM(it.units), 0)::int AS items
         FROM orders o
         LEFT JOIN (SELECT order_id, SUM(quantity)::int AS units FROM order_items GROUP BY order_id) it
           ON it.order_id = o.id
        WHERE ${inWindow}
        GROUP BY o.currency ORDER BY o.currency`,
      [lo, hi]
    );
    const [kpis, series, top, prev] = await Promise.all([
      kpiQuery(from, to),
      db.query(
        `SELECT to_char(date_trunc('${unit}', ${local}), ${fmt}) AS day, o.currency,
                COUNT(*)::int AS orders,
                COALESCE(SUM(o.total), 0)::bigint AS revenue,
                COALESCE(SUM(o.total - ${vat}), 0)::bigint AS revenue_net
           FROM orders o
          WHERE ${inWindow}
          GROUP BY 1, 2 ORDER BY 1, 2`,
        [from, to]
      ),
      db.query(
        `SELECT oi.product_name_snapshot AS name, SUM(oi.quantity)::int AS qty
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE ${inWindow}
          GROUP BY 1 ORDER BY qty DESC, name ASC LIMIT 10`,
        [from, to]
      ),
      compare ? kpiQuery(compare.from, compare.to) : null,
    ]);

    const shape = rows => rows.map((r) => {
      const revenue = Number(r.revenue);
      const vatSum = Number(r.vat);
      const net = revenue - vatSum;
      return {
        currency: r.currency,
        orders: r.orders,
        items: r.items,
        revenue,
        vat: vatSum,
        revenue_net: net,
        avg_order_value: r.orders ? Math.round(revenue / r.orders) : 0,
        avg_order_value_net: r.orders ? Math.round(net / r.orders) : 0,
      };
    });
    const byCurrency = shape(kpis.rows);
    const points = series.rows.map(r => ({
      day: r.day, currency: r.currency, orders: r.orders,
      revenue: Number(r.revenue), revenue_net: Number(r.revenue_net),
    }));
    const orders = byCurrency.reduce((s, r) => s + r.orders, 0);

    const report = {
      range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      bucket: unit,
      kpis: { orders, byCurrency },
      series: points,
      // Legacy keys (the previous release's AdminSalesView reads these).
      orders,
      revenueByCurrency: byCurrency.map(c => ({ currency: c.currency, orders: c.orders, revenue: c.revenue })),
      topProducts: top.rows,
    };
    if (unit === 'day') {
      const perDay = new Map();
      for (const p of points) perDay.set(p.day, (perDay.get(p.day) || 0) + p.orders);
      report.byDay = [...perDay].map(([date, count]) => ({ date, orders: count }));
    }
    if (prev) {
      const prevByCurrency = shape(prev.rows);
      report.compare = { from: new Date(compare.from).toISOString(), to: new Date(compare.to).toISOString() };
      report.kpisPrev = { orders: prevByCurrency.reduce((s, r) => s + r.orders, 0), byCurrency: prevByCurrency };
    }
    if (n !== null) report.days = n;
    return report;
  }
}

Order.ORDER_VIEWS = ORDER_VIEWS;
Order.SALES_BUCKETS = SALES_BUCKETS;
Order.STORE_TZ = STORE_TZ;
Order.vatTotalSql = vatTotalSql;

// Stripe webhook idempotency — insert-only; unique PK short-circuits duplicates.
class WebhookEvent {
  // Returns true if this event is new (first time seen), false if already processed.
  static async markProcessed(eventId, client = null) {
    const runner = client || db;
    try {
      await runner.query(
        `INSERT INTO processed_webhook_events (id) VALUES ($1)`,
        [String(eventId)]
      );
      return true;
    } catch (err) {
      // 23505 = unique_violation
      if (err.code === '23505') return false;
      throw err;
    }
  }
}

module.exports = Order;
module.exports.WebhookEvent = WebhookEvent;
