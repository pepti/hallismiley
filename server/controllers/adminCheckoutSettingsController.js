// Admin → Afgreiðsla (checkout settings): the ordering pause and its message,
// the minimum order value, the owner's paid-order alert list, the checkout
// field rules and the delivery price. Ported from icelandicstore #151
// (harvest2-lane7a-2026-09-26). Every value is ENFORCED server-side on the
// order path (services/checkoutRules.js, config/shipping.js); this controller
// only reads and writes them.
const Setting = require('../models/Setting');
const { isConfigured: stripeIsConfigured } = require('../config/stripe');

async function payload() {
  const [checkout, shipping] = await Promise.all([
    Setting.getCheckoutSettings(),
    Setting.getShippingSettings(),
  ]);
  return {
    settings: { ...checkout, shipping },
    status: {
      // Card checkout answers 503 until Stripe keys are set, whatever the pause.
      stripe_configured: stripeIsConfigured(),
      // The alert list falls back to this env value when left empty.
      env_notify_fallback: Boolean(String(process.env.ORDER_NOTIFY_EMAIL || '').trim()),
    },
  };
}

const adminCheckoutSettingsController = {
  // GET /api/v1/admin/checkout-settings
  async get(req, res, next) {
    try {
      return res.json(await payload());
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/checkout-settings
  // { ordering_paused?, ordering_paused_message?: { en?, is? },
  //   min_order_value_isk?, order_notify_emails?: string[] | string,
  //   fields?: { phone?, company?, kennitala?, note? },
  //   shipping?: { flat_rate_isk?, free_over_isk? } }
  // Validates EVERY group before writing ANY, then writes them in one
  // transaction — a 400 on the shipping price can never leave the pause saved.
  async update(req, res, next) {
    try {
      const { shipping, ...checkoutPatch } = req.body || {};
      const writes = [
        ...(await Setting.collectCheckoutWrites(checkoutPatch)),
        ...(shipping !== undefined ? Setting.collectShippingWrites(shipping) : []),
      ];
      await Setting.applyWrites(writes);
      return res.json(await payload());
    } catch (err) {
      if (err instanceof Setting.SettingValidationError) {
        return res.status(400).json({ error: err.message, code: 400 });
      }
      next(err);
    }
  },
};

module.exports = adminCheckoutSettingsController;
