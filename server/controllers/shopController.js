// Public shop endpoints: browse, checkout, order lookup, Stripe webhook.
// Admin-only product/order management lives in adminShopController.js.
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const Order   = require('../models/Order');
const { WebhookEvent } = require('../models/Order');
const db = require('../config/database');
const { SHIPPING_METHODS, getShippingPrice } = require('../config/shipping');
const { isConfigured: stripeIsConfigured } = require('../config/stripe');
const stripeService = require('../services/stripeService');
const { sendOrderReceipt } = require('../services/emailService');
const { t }                = require('../i18n');

const MAX_QTY_PER_ITEM   = 50;
const MAX_ITEMS_PER_ORDER = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(s) {
  return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);
}
function validateName(s, { max = 100 } = {}) {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= max;
}

function validateAddress(addr) {
  if (!addr || typeof addr !== 'object') return false;
  const { name, line1, line2, city, postal, country, phone } = addr;
  if (!validateName(name, { max: 100 })) return false;
  if (!validateName(line1, { max: 200 })) return false;
  if (line2 != null && (typeof line2 !== 'string' || line2.length > 200)) return false;
  if (!validateName(city, { max: 100 })) return false;
  if (!validateName(postal, { max: 20 })) return false;
  if (typeof country !== 'string' || country.length !== 2) return false;
  if (phone != null && (typeof phone !== 'string' || phone.length > 30)) return false;
  return true;
}

function priceForCurrency(product, currency) {
  if (currency === 'ISK') return product.price_isk;
  if (currency === 'EUR') return product.price_eur;
  throw new Error(`Unknown currency: ${currency}`);
}

// Variant price falls back to the parent product's price when the variant
// doesn't override. Always returns an integer in the currency's minor unit.
function variantPriceForCurrency(variant, product, currency) {
  const field = currency === 'ISK' ? 'price_isk' : 'price_eur';
  if (variant[field] != null) return Number(variant[field]);
  return Number(product[field]);
}

// Human-readable line name with variant axes appended: "Smiley T-shirt — Black / M"
function buildLineName(product, variant) {
  if (!variant) return product.name;
  const axes = Array.isArray(product.variant_axes) ? product.variant_axes : [];
  const bits = axes
    .map(axis => variant.attributes?.[axis])
    .filter(Boolean)
    .map(v => String(v).charAt(0).toUpperCase() + String(v).slice(1));
  return bits.length ? `${product.name} — ${bits.join(' / ')}` : product.name;
}

const shopController = {
  // GET /api/v1/shop/config — returns the publishable key for Stripe.js (if used)
  async getConfig(req, res) {
    return res.json({
      enabled: process.env.SHOP_ENABLED === 'true',
      currencies: ['ISK', 'EUR'],
      shipping: {
        flat_rate:    { priceIsk: SHIPPING_METHODS.flat_rate.priceIsk, priceEur: SHIPPING_METHODS.flat_rate.priceEur },
        local_pickup: { priceIsk: 0, priceEur: 0 },
      },
      stripe: {
        configured: stripeIsConfigured(),
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      },
    });
  },

  // GET /api/v1/shop/products — public list of active products (+ variants)
  async listProducts(req, res, next) {
    try {
      const products = await Product.findAll({ activeOnly: true, limit: 100, locale: req.locale });
      if (products.length === 0) return res.json({ products: [] });
      const productIds = products.map(p => p.id);
      const [images, variants] = await Promise.all([
        Product.listImagesForProducts(productIds),
        ProductVariant.listForProducts(productIds, { activeOnly: true }),
      ]);
      const imagesByProduct   = new Map();
      const variantsByProduct = new Map();
      for (const img of images) {
        const arr = imagesByProduct.get(img.product_id);
        if (arr) arr.push(img); else imagesByProduct.set(img.product_id, [img]);
      }
      for (const v of variants) {
        const arr = variantsByProduct.get(v.product_id);
        if (arr) arr.push(v); else variantsByProduct.set(v.product_id, [v]);
      }
      const withAll = products.map(p => ({
        ...p,
        images:   imagesByProduct.get(p.id)   || [],
        variants: variantsByProduct.get(p.id) || [],
      }));
      return res.json({ products: withAll });
    } catch (err) { next(err); }
  },

  // GET /api/v1/shop/products/:slug — public product detail (active only)
  async getProduct(req, res, next) {
    try {
      const product = await Product.findBySlug(req.params.slug, { activeOnly: true, locale: req.locale });
      if (!product) return res.status(404).json({ error: t(req.locale, 'errors.shop.productNotFound'), code: 404 });
      const [images, variants] = await Promise.all([
        Product.listImages(product.id),
        ProductVariant.listForProduct(product.id, { activeOnly: true }),
      ]);
      return res.json({ product: { ...product, images, variants } });
    } catch (err) { next(err); }
  },

  // POST /api/v1/shop/checkout — create an order + Stripe Checkout Session
  async createCheckoutSession(req, res, next) {
    try {
      if (!stripeIsConfigured()) {
        return res.status(503).json({ error: t(req.locale, 'errors.shop.checkoutUnavailable'), code: 503 });
      }

      const {
        items,
        currency,
        shipping_method: shippingMethod,
        shipping_address: shippingAddress = null,
        guest_email: guestEmailRaw = null,
        guest_name:  guestNameRaw  = null,
      } = req.body || {};

      // ── Validation ──────────────────────────────────────────────────────
      if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS_PER_ORDER) {
        return res.status(400).json({ error: t(req.locale, 'errors.shop.itemsNonEmpty', { n: MAX_ITEMS_PER_ORDER }), code: 400 });
      }
      if (!['ISK', 'EUR'].includes(currency)) {
        return res.status(400).json({ error: t(req.locale, 'errors.shop.invalidCurrency'), code: 400 });
      }
      if (!['flat_rate', 'local_pickup'].includes(shippingMethod)) {
        return res.status(400).json({ error: t(req.locale, 'errors.shop.invalidShippingMethod'), code: 400 });
      }

      // Auth: either a logged-in user OR guest email must be provided
      const user = req.user || null;
      let guestEmail = null;
      let guestName  = null;
      let customerEmail = null;
      if (user) {
        customerEmail = user.email || null;
      } else {
        if (!validateEmail(guestEmailRaw)) {
          return res.status(400).json({ error: t(req.locale, 'errors.shop.guestEmailRequired'), code: 400 });
        }
        if (!validateName(guestNameRaw, { max: 100 })) {
          return res.status(400).json({ error: t(req.locale, 'errors.shop.guestNameRequired'), code: 400 });
        }
        guestEmail = guestEmailRaw.trim().toLowerCase();
        guestName  = guestNameRaw.trim();
        customerEmail = guestEmail;
      }

      // Shipping address required only when the method needs it
      const method = SHIPPING_METHODS[shippingMethod];
      if (method.requiresAddress) {
        if (!validateAddress(shippingAddress)) {
          return res.status(400).json({ error: t(req.locale, 'errors.shop.shippingAddressRequired'), code: 400 });
        }
      }

      // ── Re-fetch prices from DB (A04: never trust client prices) ──────
      // Each item is either { variantId, quantity } (variant-backed SKU) or
      // { productId, quantity } (single-SKU product with no variants).
      const resolvedItems = [];
      for (const it of items) {
        const qty = Math.floor(Number(it.quantity));
        if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM) {
          return res.status(400).json({ error: t(req.locale, 'errors.shop.invalidQuantity', { max: MAX_QTY_PER_ITEM }), code: 400 });
        }

        if (it.variantId) {
          const variant = await ProductVariant.findById(String(it.variantId));
          if (!variant || !variant.active) {
            return res.status(404).json({ error: t(req.locale, 'errors.shop.variantNotFound', { id: it.variantId }), code: 404 });
          }
          const product = await Product.findById(variant.product_id, { activeOnly: true, locale: req.locale });
          if (!product) {
            return res.status(404).json({ error: t(req.locale, 'errors.shop.productNotFound'), code: 404 });
          }
          if (variant.stock < qty) {
            return res.status(409).json({
              error: t(req.locale, 'errors.shop.notEnoughStock', { name: buildLineName(product, variant) }),
              code: 409,
            });
          }
          resolvedItems.push({
            productId: product.id,
            variantId: variant.id,
            variantAttributes: variant.attributes,
            name: buildLineName(product, variant),
            price: variantPriceForCurrency(variant, product, currency),
            quantity: qty,
          });
        } else if (it.productId) {
          // Single-SKU product (no variants). Kept for forward compatibility
          // with future non-apparel products like gift cards.
          const product = await Product.findBySlug(it.productId, { activeOnly: true, locale: req.locale })
                        || await Product.findById(it.productId, { activeOnly: true, locale: req.locale });
          if (!product) {
            return res.status(404).json({ error: t(req.locale, 'errors.shop.productNotFound'), code: 404 });
          }
          // Reject products that use variants — caller must pick a variant first.
          if (Array.isArray(product.variant_axes) && product.variant_axes.length > 0) {
            return res.status(400).json({
              error: t(req.locale, 'errors.shop.variantRequired', { name: product.name }),
              code: 400,
            });
          }
          if (product.stock < qty) {
            return res.status(409).json({ error: t(req.locale, 'errors.shop.notEnoughStock', { name: product.name }), code: 409 });
          }
          resolvedItems.push({
            productId: product.id,
            variantId: null,
            variantAttributes: null,
            name: product.name,
            price: priceForCurrency(product, currency),
            quantity: qty,
          });
        } else {
          return res.status(400).json({ error: t(req.locale, 'errors.shop.itemNeedsId'), code: 400 });
        }
      }

      const shippingAmount = getShippingPrice(shippingMethod, currency);

      // ── Insert order (status=pending) in a transaction ────────────────
      const order = await Order.createWithItems({
        userId: user?.id || null,
        guestEmail,
        guestName,
        currency,
        shippingMethod,
        shippingAddress: method.requiresAddress ? shippingAddress : null,
        items: resolvedItems,
        shipping: shippingAmount,
      });

      // ── Create Stripe Checkout Session ────────────────────────────────
      // Line-item names already include the variant ("Smiley T-shirt — Black / M")
      // so the Stripe Checkout page and customer receipt show the right SKU.
      const session = await stripeService.createCheckoutSession({
        items: resolvedItems.map(it => ({
          productId: it.productId,
          variantId: it.variantId || undefined,
          name: it.name,
          priceStripe: stripeService.toStripeAmount(it.price, currency),
          quantity: it.quantity,
        })),
        currency,
        customerEmail,
        shipping: shippingAmount,
        shippingMethodLabel: method.label,
        orderId: order.id,
        orderNumber: order.order_number,
      });

      await Order.setStripeSession(order.id, session.id);

      return res.status(201).json({
        url: session.url,
        orderNumber: order.order_number,
        sessionId: session.id,
      });
    } catch (err) {
      if (err.code === 'STRIPE_NOT_CONFIGURED') {
        return res.status(503).json({ error: t(req.locale, 'errors.shop.checkoutUnavailable'), code: 503 });
      }
      next(err);
    }
  },

  // GET /api/v1/shop/orders/by-session/:sessionId — used by success page polling
  async getOrderBySession(req, res, next) {
    try {
      const order = await Order.findByStripeSessionId(req.params.sessionId);
      if (!order) return res.status(404).json({ error: t(req.locale, 'errors.shop.orderNotFound'), code: 404 });
      const items = await Order.listItems(order.id);
      // Return a minimal public view — strip payment intent ids
      const publicOrder = {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        currency: order.currency,
        subtotal: order.subtotal,
        shipping: order.shipping,
        total: order.total,
        shipping_method: order.shipping_method,
        paid_at: order.paid_at,
        created_at: order.created_at,
      };
      return res.json({ order: publicOrder, items });
    } catch (err) { next(err); }
  },

  // GET /api/v1/shop/orders/mine — logged-in user's order history
  async getMyOrders(req, res, next) {
    try {
      const orders = await Order.findByUserId(req.user.id, { limit: 50 });
      return res.json({ orders });
    } catch (err) { next(err); }
  },

  // POST /api/v1/shop/webhook — Stripe webhook
  // MUST be mounted with express.raw() BEFORE express.json() in app.js.
  async handleStripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      return res.status(400).send('Missing stripe-signature header');
    }
    if (!Buffer.isBuffer(req.body)) {
      // Defensive: a future refactor that moves express.json() above this
      // route would silently break signature verification. Fail loudly.
      console.error('[stripeWebhook] req.body is not a Buffer — raw body parser missing');
      return res.status(500).send('Webhook misconfigured: raw body required');
    }

    let event;
    try {
      event = stripeService.verifyWebhook(req.body, sig);
    } catch (err) {
      console.warn(`[stripeWebhook] Invalid signature: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Idempotency — mark event as processed once
    const isNew = await WebhookEvent.markProcessed(event.id);
    if (!isNew) {
      return res.status(200).send('Already processed');
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          await handleCheckoutCompleted(event.data.object);
          break;
        }
        case 'payment_intent.payment_failed': {
          await handlePaymentFailed(event.data.object);
          break;
        }
        default:
          // Ignore other event types
          break;
      }
      return res.status(200).send('OK');
    } catch (err) {
      console.error(`[stripeWebhook] Processing ${event.type} failed:`, err);
      // Don't return 5xx here — Stripe will retry and we already marked the
      // event processed. Return 200 so we don't flood retries, but log loud.
      return res.status(200).send('Processed with errors');
    }
  },
};

// ── Webhook handlers ────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session) {
  const order = await Order.findByStripeSessionId(session.id);
  if (!order) {
    console.warn(`[stripeWebhook] checkout.session.completed: order not found for session ${session.id}`);
    return;
  }
  if (order.status !== 'pending') {
    // Already paid (likely a retried event that came after an out-of-band
    // admin update) — nothing to do.
    return;
  }

  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;

  // Atomic transition pending→paid + atomic stock decrement per item.
  const client = await db.pool.connect();
  let transitioned = null;
  let stockLost = false;
  try {
    await client.query('BEGIN');

    transitioned = await Order.markPaidIfPending(client, order.id, paymentIntentId);
    if (!transitioned) {
      // Another process already paid it
      await client.query('COMMIT');
      return;
    }

    const items = await Order.listItems(order.id);
    for (const it of items) {
      // Variant-backed items decrement variant stock; legacy single-SKU
      // items fall back to product stock. Both use atomic WHERE stock >= qty
      // so a race-loser returns null and we abort the whole transaction.
      const newStock = it.product_variant_id
        ? await ProductVariant.decrementStockAtomic(client, it.product_variant_id, it.quantity)
        : await Product.decrementStockAtomic(client, it.product_id, it.quantity);
      if (newStock === null) {
        stockLost = true;
        break;
      }
    }

    if (stockLost) {
      // Roll back stock + status transition — order will be marked failed outside the tx
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (stockLost) {
    // Lost the stock race — refund and mark failed.
    console.warn(`[stripeWebhook] Stock race lost on order ${order.order_number}; refunding`);
    await Order.updateStatus(order.id, 'failed', { stripePaymentIntentId: paymentIntentId });
    if (paymentIntentId) {
      try {
        await stripeService.createRefund(paymentIntentId, { reason: 'requested_by_customer' });
      } catch (refundErr) {
        console.error(`[stripeWebhook] Refund failed for order ${order.order_number}:`, refundErr);
      }
    }
    return;
  }

  // Success path — send receipt (best-effort; don't fail the webhook on email errors)
  try {
    const items = await Order.listItems(order.id);
    const finalOrder = await Order.findById(order.id);
    let locale = 'en';
    if (finalOrder.user_id) {
      const { rows: uRows } = await db.query(
        'SELECT preferred_locale FROM users WHERE id = $1',
        [finalOrder.user_id]
      );
      if (uRows[0]?.preferred_locale) locale = uRows[0].preferred_locale;
    }
    await sendOrderReceipt(finalOrder, items, locale);
  } catch (emailErr) {
    console.error(`[stripeWebhook] Receipt email failed for ${order.order_number}:`, emailErr);
  }
}

async function handlePaymentFailed(paymentIntent) {
  // Find the order by PI id — or by linked session if we already persisted it
  const piId = paymentIntent.id;
  const { rows } = await db.query(
    `SELECT id FROM orders WHERE stripe_payment_intent_id = $1 OR stripe_session_id IN (
        SELECT id FROM orders WHERE stripe_payment_intent_id = $1
     )`,
    [piId]
  );
  const orderRow = rows[0];
  if (!orderRow) return;
  await Order.updateStatus(orderRow.id, 'failed', { stripePaymentIntentId: piId });
}

module.exports = shopController;
