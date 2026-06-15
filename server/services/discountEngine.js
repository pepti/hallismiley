// Discount application engine (B2C subset — see migrations 049 + 054).
// Supports two methods (code, automatic) and two types (order amount, free
// shipping). Given a code (or none, for automatic discovery) + the order
// subtotal/shipping (minor units) + currency, it validates through ordered
// gates and returns the amount(s) to subtract. Order-level percentage/fixed +
// free shipping only — no product/collection targeting or buy-X-get-Y.
//
// computeForCheckout → { discount, discountAmount, shippingDiscount } | { error }
//   (discount === null with zero amounts = "no automatic discount applied").
// computeForCode → legacy { discount, amount, ... } shape for the public
//   /discounts/validate preview endpoint.
// Money is integers in the currency's minor unit (ISK = whole krónur).
const Discount = require('../models/Discount');

const MESSAGES = {
  invalidCode:       'This discount code is not valid.',
  scheduled:         'This discount code is not active yet.',
  expired:           'This discount code has expired.',
  usageLimitReached: 'This discount code has reached its usage limit.',
  currencyMismatch:  'This discount code does not apply to this currency.',
  minSubtotal:       'Your order does not meet the minimum for this code.',
  notApplicable:     'This discount code does not apply to your order.',
};

function fail(status, reason, params) {
  return { error: { status, reason, message: MESSAGES[reason] || 'Invalid discount code.', params } };
}

// Ordered validation gates shared by code + automatic paths. Returns an error
// object (from fail()) or null when the discount passes.
function runGates(d, { subtotal, currency }) {
  const now = Date.now();
  if (d.starts_at && new Date(d.starts_at).getTime() > now) return fail(422, 'scheduled');
  if (d.ends_at   && new Date(d.ends_at).getTime()  <= now) return fail(422, 'expired');
  if (d.usage_limit != null && Number(d.used_count) >= Number(d.usage_limit)) {
    return fail(409, 'usageLimitReached');
  }
  if (d.currency !== currency) return fail(422, 'currencyMismatch');
  const sub = Math.max(0, Math.floor(Number(subtotal) || 0));
  if (d.min_subtotal != null && sub < Number(d.min_subtotal)) {
    return fail(422, 'minSubtotal', { amount: Number(d.min_subtotal) });
  }
  return null;
}

// Compute the benefit of one discount against the order. Returns
// { discountAmount, shippingDiscount } (order amount vs free shipping), or null
// when it yields nothing (e.g. a 0-value order discount).
function benefitOf(d, { subtotal, shippingAmount }) {
  const sub = Math.max(0, Math.floor(Number(subtotal) || 0));
  if (d.type === 'free_shipping') {
    // Valid even when shippingAmount is 0 (e.g. local pickup / preview) — the
    // realized benefit is computed against the actual shipping at checkout.
    return { discountAmount: 0, shippingDiscount: Math.max(0, Math.floor(Number(shippingAmount) || 0)) };
  }
  const raw = d.value_type === 'percentage'
    ? Math.round(sub * Number(d.value) / 100)
    : Math.min(Number(d.value), sub);
  const discountAmount = Math.max(0, Math.min(raw, sub));
  if (discountAmount <= 0) return null;
  return { discountAmount, shippingDiscount: 0 };
}

/**
 * Resolve the discount for a checkout.
 *  - code given   → look it up; gate failures surface as user-facing errors.
 *  - no code      → discover the best live automatic discount; any that fail
 *                   gates are silently skipped (no error — just no discount).
 * @returns {Promise<{discount, discountAmount, shippingDiscount} | {error}>}
 */
async function computeForCheckout({ code, subtotal, shippingAmount = 0, currency = 'ISK' }) {
  const trimmed = typeof code === 'string' ? code.trim() : '';

  if (trimmed) {
    const d = await Discount.findByCodeCI(trimmed);
    if (!d || !d.enabled) return fail(404, 'invalidCode'); // don't leak existence
    const gateErr = runGates(d, { subtotal, currency });
    if (gateErr) return gateErr;
    const benefit = benefitOf(d, { subtotal, shippingAmount });
    if (!benefit) return fail(422, 'notApplicable');
    return { discount: d, ...benefit };
  }

  // Automatic discovery — pick the candidate with the greatest total benefit.
  const candidates = await Discount.findLiveAutomatic({ currency });
  let best = null, bestValue = 0;
  for (const d of candidates) {
    if (runGates(d, { subtotal, currency })) continue;
    const benefit = benefitOf(d, { subtotal, shippingAmount });
    if (!benefit) continue;
    const value = benefit.discountAmount + benefit.shippingDiscount;
    if (value > bestValue) { best = { discount: d, ...benefit }; bestValue = value; }
  }
  return best || { discount: null, discountAmount: 0, shippingDiscount: 0 };
}

// Public preview (POST /discounts/validate). Always code-based; reports the
// order amount and whether the code grants free shipping.
async function computeForCode({ code, subtotal, currency = 'ISK' }) {
  const r = await computeForCheckout({ code, subtotal, shippingAmount: 0, currency });
  if (r.error) return r;
  if (!r.discount) return fail(404, 'invalidCode');
  return {
    discount: r.discount,
    amount: r.discountAmount,
    freeShipping: r.discount.type === 'free_shipping',
  };
}

module.exports = { computeForCheckout, computeForCode };
