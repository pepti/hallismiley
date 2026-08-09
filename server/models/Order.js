// Repository pattern for orders + order_items + processed webhook events.
// All money stored as integers in the order's currency's smallest unit.
const crypto = require('crypto');
const db = require('../config/database');

const COLUMNS = `id, order_number, user_id, guest_email, guest_name, currency,
  subtotal, shipping, total, status, payment_status, fulfillment_status,
  shipping_method, shipping_address,
  stripe_session_id, stripe_payment_intent_id, paid_at, fulfilled_at, tags,
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

// WHERE builder shared by listAll + count. B2C: search spans the order number,
// the guest email/name, and the linked user's email.
function buildOrderFilter({ status = null, paymentStatus = null, fulfillmentStatus = null, q = null } = {}) {
  const params = [];
  const where  = [];
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

class Order {
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
           discount_code, discount_title, discount_amount, shipping_discount
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12, $13, $14)
         RETURNING ${COLUMNS}`,
        [
          orderNumber, userId, guestEmail, guestName, currency,
          subtotal, Number(shipping), total, shippingMethod,
          shippingAddress ? JSON.stringify(shippingAddress) : null,
          disc ? disc.code : null,
          disc ? (disc.title || disc.code) : null,
          discountAmount, shippingDiscount,
        ]
      );
      const order = orderRows[0];

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
                         q = null, sort = 'date', dir = 'desc', limit = 100, offset = 0 } = {}) {
    const { clause, params } = buildOrderFilter({ status, paymentStatus, fulfillmentStatus, q });
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

  static async count({ status = null, paymentStatus = null, fulfillmentStatus = null, q = null } = {}) {
    const { clause, params } = buildOrderFilter({ status, paymentStatus, fulfillmentStatus, q });
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
  static async setOrderStatuses(id, { payment_status, fulfillment_status } = {}) {
    const current = await Order.findById(id);
    if (!current) return null;
    const payment     = payment_status     != null ? payment_status     : current.payment_status;
    const fulfillment = fulfillment_status != null ? fulfillment_status : current.fulfillment_status;
    if (!PAYMENT_STATES.includes(payment))         throw new Error(`Invalid payment_status: ${payment}`);
    if (!FULFILLMENT_STATES.includes(fulfillment)) throw new Error(`Invalid fulfillment_status: ${fulfillment}`);
    const status  = deriveStatus(payment, fulfillment);
    const paidSql = payment === 'paid' ? 'COALESCE(paid_at, NOW())' : payment === 'pending' ? 'NULL' : 'paid_at';
    const fulSql  = (fulfillment === 'fulfilled' || fulfillment === 'delivered') ? 'COALESCE(fulfilled_at, NOW())'
                  : fulfillment === 'unfulfilled' ? 'NULL' : 'fulfilled_at';
    const { rows } = await db.query(
      `UPDATE orders
          SET payment_status = $1, fulfillment_status = $2, status = $3,
              paid_at = ${paidSql}, fulfilled_at = ${fulSql}
        WHERE id = $4
      RETURNING ${COLUMNS}`,
      [payment, fulfillment, status, String(id)]
    );
    return rows[0] || null;
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
    const { rows } = await db.query(
      `SELECT ${ITEM_COLUMNS.split(',').map(c => `oi.${c.trim()}`).join(', ')},
              COALESCE(p.is_bookable, FALSE) AS is_bookable
         FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1
        ORDER BY oi.created_at ASC`,
      [String(orderId)]
    );
    return rows;
  }

  // Aggregate sales over the last `days` (paid orders only — paid_at set).
  // Revenue is grouped by currency to avoid mixing ISK + EUR; byDay (order
  // count) and topProducts (units sold) are currency-agnostic so they're always
  // comparable. Backs the admin sales report.
  static async salesReport({ days = 30 } = {}) {
    const n = Math.min(365, Math.max(1, Math.floor(Number(days) || 30)));
    const since = `NOW() - ($1 || ' days')::interval`;
    const [sum, byDay, top] = await Promise.all([
      db.query(
        `SELECT currency, COUNT(*)::int AS orders, COALESCE(SUM(total),0)::bigint AS revenue
           FROM orders WHERE paid_at IS NOT NULL AND paid_at >= ${since}
          GROUP BY currency ORDER BY currency`,
        [String(n)]
      ),
      db.query(
        `SELECT to_char(date_trunc('day', paid_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS orders
           FROM orders WHERE paid_at IS NOT NULL AND paid_at >= ${since}
          GROUP BY 1 ORDER BY 1`,
        [String(n)]
      ),
      db.query(
        `SELECT oi.product_name_snapshot AS name, SUM(oi.quantity)::int AS qty
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.paid_at IS NOT NULL AND o.paid_at >= ${since}
          GROUP BY 1 ORDER BY qty DESC LIMIT 10`,
        [String(n)]
      ),
    ]);
    const revenueByCurrency = sum.rows.map(r => ({ currency: r.currency, orders: r.orders, revenue: Number(r.revenue) }));
    const orders = revenueByCurrency.reduce((s, r) => s + r.orders, 0);
    return { days: n, orders, revenueByCurrency, byDay: byDay.rows, topProducts: top.rows };
  }
}

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
