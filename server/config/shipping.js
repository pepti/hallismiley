// Shipping methods for the shop. Simple MVP: two hard-coded options.
// Prices are integers in the smallest unit of each currency:
//   ISK: whole krónur (1 ISK = 1 unit — no subunit)
//   EUR: cents        (1 EUR = 100 cents)
// Override via env vars SHIPPING_FLAT_RATE_ISK and SHIPPING_FLAT_RATE_EUR.

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

function getShippingPrice(method, currency) {
  const m = SHIPPING_METHODS[method];
  if (!m) throw new Error(`Unknown shipping method: ${method}`);
  if (currency === 'ISK') return m.priceIsk;
  if (currency === 'EUR') return m.priceEur;
  throw new Error(`Unknown currency: ${currency}`);
}

module.exports = { SHIPPING_METHODS, getShippingPrice };
