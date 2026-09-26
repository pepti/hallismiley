// Shipping methods for the shop. Simple MVP: two options.
// Prices are integers in the smallest unit of each currency:
//   ISK: whole krónur (1 ISK = 1 unit — no subunit)
//   EUR: cents        (1 EUR = 100 cents)
//
// Since harvest 2 lane 7a (2026-09-26, ported from icelandicstore #151) the ISK
// flat rate and a free-over threshold are ADMIN SETTINGS (Setting.getShipping
// Settings; Admin → Afgreiðsla). The env vars are only the fallback before an
// admin saves: SHIPPING_FLAT_RATE_ISK (default 2500) is the flat_rate_isk
// default, so an existing instance charges exactly what it did until then.
// SHIPPING_FLAT_RATE_EUR stays env-only (EUR has no setting).
//
// ONE rule, two callers: the order total (shopController.createCheckoutSession,
// through resolveShippingPrice) and the cart/checkout display (the client twin
// public/js/utils/shipping.js, fed the same rates by GET /shop/config).
// tests/unit/shippingParity.test.js holds the two together.

function parseIntEnv(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const FLAT_ISK = parseIntEnv('SHIPPING_FLAT_RATE_ISK', 2500);
const FLAT_EUR = parseIntEnv('SHIPPING_FLAT_RATE_EUR', 1900); // 19.00 €

const SHIPPING_METHODS = {
  flat_rate: {
    id: 'flat_rate',
    label: 'Shipping',
    priceIsk: FLAT_ISK,
    priceEur: FLAT_EUR,
    requiresAddress: true,
  },
  local_pickup: {
    id: 'local_pickup',
    label: 'Local pickup',
    priceIsk: 0,
    priceEur: 0,
    requiresAddress: false,
  },
};

// ⚠ ENV-FROZEN price captured at boot — it does NOT see the admin shipping
// settings. Kept for callers that need the boot-time default; the order path
// uses resolveShippingPrice.
function getShippingPrice(method, currency) {
  const m = SHIPPING_METHODS[method];
  if (!m) throw new Error(`Unknown shipping method: ${method}`);
  if (currency === 'ISK') return m.priceIsk;
  if (currency === 'EUR') return m.priceEur;
  throw new Error(`Unknown currency: ${currency}`);
}

/**
 * The delivery price — pure, the rule the client twin mirrors.
 * @param {object} a
 * @param {'flat_rate'|'local_pickup'} a.method
 * @param {'ISK'|'EUR'} a.currency
 * @param {{ flatRateIsk: number, flatRateEur: number, freeOverIsk: number }} a.rates
 * @param {number} a.iskSubtotal  the basket at its ISK prices, before discounts
 *   (the threshold is ISK whatever the charge currency, so a EUR basket is
 *   measured by the same lines' ISK prices)
 * @returns {number} minor units of `currency`
 */
function computeShippingPrice({ method, currency, rates, iskSubtotal }) {
  if (!SHIPPING_METHODS[method]) throw new Error(`Unknown shipping method: ${method}`);
  if (currency !== 'ISK' && currency !== 'EUR') throw new Error(`Unknown currency: ${currency}`);
  if (method === 'local_pickup') return 0;
  const freeOver = Number(rates.freeOverIsk) || 0;
  if (freeOver > 0 && Number(iskSubtotal) >= freeOver) return 0;
  return currency === 'ISK' ? Number(rates.flatRateIsk) : Number(rates.flatRateEur);
}

/** The live rates: the admin setting for ISK, the env for EUR. */
async function shippingRates() {
  const Setting = require('../models/Setting'); // late require: config/ loads before models
  const s = await Setting.getShippingSettings();
  return { flatRateIsk: s.flat_rate_isk, flatRateEur: FLAT_EUR, freeOverIsk: s.free_over_isk };
}

/** Settings-aware price for the order path. */
async function resolveShippingPrice(method, currency, { iskSubtotal = 0 } = {}) {
  return computeShippingPrice({ method, currency, rates: await shippingRates(), iskSubtotal });
}

module.exports = {
  SHIPPING_METHODS, getShippingPrice, computeShippingPrice, shippingRates, resolveShippingPrice,
};
