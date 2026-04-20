// Stripe integration helpers. Keep all Stripe API calls here so controllers
// remain thin and stripe-agnostic for testing.
const { getStripe } = require('../config/stripe');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Stripe expects amounts in the smallest currency unit (integers):
//   ISK: whole krónur — no subunit.
//   EUR: cents.
// Our DB already stores both in smallest-unit form, so this helper is
// the identity function. It exists so nobody is tempted to *100 in the
// EUR path (double-up bug) — the single source of truth is here.
function toStripeAmount(price, _currency) {
  return Math.round(Number(price));
}

async function createCheckoutSession({
  items,       // [{ name, priceStripe, quantity, productId }]
  currency,    // 'ISK' | 'EUR'
  customerEmail = null,
  shipping,    // integer minor units
  shippingMethodLabel,
  orderId,
  orderNumber,
}) {
  const stripe = getStripe();

  const line_items = items.map(it => ({
    price_data: {
      currency: currency.toLowerCase(),
      product_data: {
        name: it.name,
        // Include productId and (when applicable) variantId in Stripe's
        // product_data.metadata for downstream reconciliation / reporting.
        metadata: {
          productId: it.productId,
          ...(it.variantId ? { variantId: it.variantId } : {}),
        },
      },
      unit_amount: it.priceStripe,
    },
    quantity: it.quantity,
  }));

  // Shipping is a separate line item (rather than Stripe Shipping Rates)
  // because Stripe Shipping Rates are currency-locked per rate object; this
  // keeps our multi-currency flow simple (one currency per session).
  if (shipping > 0) {
    line_items.push({
      price_data: {
        currency: currency.toLowerCase(),
        product_data: { name: shippingMethodLabel || 'Shipping' },
        unit_amount: shipping,
      },
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    // automatic_payment_methods supersedes payment_method_types. Stripe
    // surfaces every method enabled in the Dashboard that is supported in
    // the customer's region — including Apple Pay and Google Pay on compatible
    // browsers, plus Link, SEPA, Klarna, etc. No domain verification needed for
    // wallets on hosted Checkout (checkout.stripe.com is pre-verified).
    automatic_payment_methods: { enabled: true },
    line_items,
    customer_email: customerEmail || undefined,
    success_url: `${APP_URL}/#/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${APP_URL}/#/checkout/cancel?session_id={CHECKOUT_SESSION_ID}`,
    metadata: { orderId, orderNumber },
  });

  return session;
}

function verifyWebhook(rawBody, signatureHeader) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const err = new Error('STRIPE_WEBHOOK_SECRET is not set');
    err.code = 'STRIPE_WEBHOOK_SECRET_MISSING';
    throw err;
  }
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}

async function createRefund(paymentIntentId, { reason = 'requested_by_customer' } = {}) {
  const stripe = getStripe();
  return stripe.refunds.create({ payment_intent: paymentIntentId, reason });
}

module.exports = {
  toStripeAmount,
  createCheckoutSession,
  verifyWebhook,
  createRefund,
};
