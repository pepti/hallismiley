// The delivery price the cart and the checkout SHOW — the client twin of
// server/config/shipping.js computeShippingPrice (harvest2-lane7a, ported from
// icelandicstore #151). One rule, two places: the server charges it, this
// displays it, and tests/unit/shippingParity.test.js holds the two together.
// Display only: the order total is always the server's.

/** GET /shop/config's `shipping` block → the rates the rule reads. */
export function ratesFromConfig(shipping) {
  const flat = (shipping && shipping.flat_rate) || {};
  return {
    flatRateIsk: Number(flat.priceIsk) || 0,
    flatRateEur: Number(flat.priceEur) || 0,
    freeOverIsk: Number(shipping && shipping.free_over_isk) || 0,
  };
}

/**
 * @param {{ method: 'flat_rate'|'local_pickup', currency: 'ISK'|'EUR',
 *   rates: { flatRateIsk: number, flatRateEur: number, freeOverIsk: number },
 *   iskSubtotal: number }} a  iskSubtotal = the basket at ISK prices, before
 *   discounts (the threshold is ISK whatever the display currency)
 * @returns {number} minor units of `currency`
 */
export function computeShippingPrice({ method, currency, rates, iskSubtotal }) {
  if (method !== 'flat_rate' && method !== 'local_pickup') throw new Error(`Unknown shipping method: ${method}`);
  if (currency !== 'ISK' && currency !== 'EUR') throw new Error(`Unknown currency: ${currency}`);
  if (method === 'local_pickup') return 0;
  const freeOver = Number(rates.freeOverIsk) || 0;
  if (freeOver > 0 && Number(iskSubtotal) >= freeOver) return 0;
  return currency === 'ISK' ? Number(rates.flatRateIsk) : Number(rates.flatRateEur);
}
