// Discount application engine (B2C subset — see migration 049 / models/Discount).
// Given a code + an order subtotal (minor units) + currency, it validates the
// code through ordered gates and returns the amount to subtract. Order-level
// percentage/fixed only. Money is integers in the currency's minor unit
// (ISK = whole krónur); rounding is half-up on the integer base.
//
// Returns { discount, amount } on success, or { error: { status, reason,
// message, params } } on failure. The caller maps `reason` to a localized
// string client-side; `message` is a safe English default.
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

// code: string; subtotal: minor-unit integer; currency: 'ISK' | 'EUR'.
async function computeForCode({ code, subtotal, currency = 'ISK' }) {
  const trimmed = typeof code === 'string' ? code.trim() : '';
  if (!trimmed) return fail(400, 'invalidCode');

  const d = await Discount.findByCodeCI(trimmed);
  // Don't leak existence — a disabled code reads the same as a missing one.
  if (!d || !d.enabled) return fail(404, 'invalidCode');

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

  const raw = d.value_type === 'percentage'
    ? Math.round(sub * Number(d.value) / 100)
    : Math.min(Number(d.value), sub);
  const amount = Math.max(0, Math.min(raw, sub));
  if (amount <= 0) return fail(422, 'notApplicable');

  return { discount: d, amount };
}

module.exports = { computeForCode };
