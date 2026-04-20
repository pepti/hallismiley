// Lazy Stripe client factory. Reads STRIPE_SECRET_KEY at first use so the app
// still boots (for dev and for phases that don't touch Stripe) without the key.
// Any code path that actually invokes Stripe will throw if the key is missing.

let _client = null;

function getStripe() {
  if (_client) return _client;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const err = new Error(
      'STRIPE_SECRET_KEY is not set. Configure it in .env (dev) or ' +
      '`az webapp config appsettings set` (prod) before enabling checkout.'
    );
    err.code = 'STRIPE_NOT_CONFIGURED';
    throw err;
  }

  // eslint-disable-next-line global-require
  const Stripe = require('stripe');
  _client = new Stripe(key, {
    // Pin a specific API version so Stripe library upgrades don't silently
    // change response shapes. Update deliberately when moving versions.
    apiVersion: '2024-12-18.acacia',
    maxNetworkRetries: 2,
  });
  return _client;
}

function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

module.exports = { getStripe, isConfigured };
