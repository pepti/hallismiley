// What the cart and the checkout must SHOW about the checkout settings
// (harvest2-lane7a, ported from icelandicstore #151): the ordering pause and
// its message, the minimum order and how far the basket is from it, the
// free-delivery threshold, and the field rules. Pure — the views render it.
//
// UX only. POST /api/v1/shop/checkout enforces all of it on the server
// (services/checkoutRules.js): the pause is a 503 there, the minimum a 400 on
// the subtotal AFTER discounts. The basket here is measured before discounts,
// so the page can only under-warn, never block an order the server would take.

const RULES = ['optional', 'required', 'hidden'];
const FIELD_DEFAULTS = { phone: 'optional', company: 'hidden', kennitala: 'hidden', note: 'optional' };

/**
 * @param {object|null} cfg   GET /api/v1/shop/config (null when unreachable)
 * @param {number} iskSubtotal the basket at ISK prices
 * @param {'is'|'en'} locale
 */
export function checkoutState(cfg, iskSubtotal, locale = 'is') {
  const c = (cfg && cfg.checkout) || {};
  const msgs = c.ordering_paused_message || {};
  const loc = locale === 'en' ? 'en' : 'is';
  const minIsk = Number(c.min_order_value_isk) || 0;
  const sub = Number(iskSubtotal) || 0;
  const fields = {};
  for (const [name, dflt] of Object.entries(FIELD_DEFAULTS)) {
    const v = c.fields && c.fields[name];
    fields[name] = RULES.includes(v) ? v : dflt;
  }
  const paused = c.ordering_paused === true;
  const belowMin = minIsk > 0 && sub < minIsk;
  return {
    paused,
    // '' → the caller shows its i18n default
    pausedMessage: paused && typeof msgs[loc] === 'string' ? msgs[loc].trim() : '',
    minIsk,
    belowMin,
    missingIsk: belowMin ? minIsk - sub : 0,
    freeOverIsk: Number(cfg && cfg.shipping && cfg.shipping.free_over_isk) || 0,
    fields,
    blocked: paused || belowMin,
  };
}
