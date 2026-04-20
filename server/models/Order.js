// Repository pattern for orders + order_items + processed webhook events.
// All money stored as integers in the order's currency's smallest unit.
const crypto = require('crypto');
const db = require('../config/database');

const COLUMNS = `id, order_number, user_id, guest_email, guest_name, currency,
  subtotal, shipping, total, status, shipping_method, shipping_address,
  stripe_session_id, stripe_payment_intent_id, paid_at, created_at, updated_at`;

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
    const total    = subtotal + Number(shipping);
    const orderNumber = generateOrderNumber();

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (
           order_number, user_id, guest_email, guest_name, currency,
           subtotal, shipping, total, status, shipping_method, shipping_address
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)
         RETURNING ${COLUMNS}`,
        [
          orderNumber, userId, guestEmail, guestName, currency,
          subtotal, Number(shipping), total, shippingMethod,
          shippingAddress ? JSON.stringify(shippingAddress) : null,
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

  static async listAll({ status = null, limit = 100, offset = 0 } = {}) {
    const params = [];
    let where = '';
    if (status) {
      params.push(String(status));
      where = `WHERE status = $${params.length}`;
    }
    params.push(Number(limit));
    params.push(Number(offset));
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM orders ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows;
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
          SET status = 'paid', paid_at = NOW(), stripe_payment_intent_id = $1
        WHERE id = $2 AND status = 'pending'
      RETURNING ${COLUMNS}`,
      [String(stripePaymentIntentId), String(orderId)]
    );
    return rows[0] || null;
  }

  static async listItems(orderId) {
    const { rows } = await db.query(
      `SELECT ${ITEM_COLUMNS} FROM order_items
        WHERE order_id = $1
        ORDER BY created_at ASC`,
      [String(orderId)]
    );
    return rows;
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
