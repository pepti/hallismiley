// Admin discount management — list / create / update code-based order discounts.
// Admin role enforced in adminDiscountRoutes.js.
const Discount = require('../models/Discount');

const VALUE_TYPES = ['percentage', 'fixed'];
const CURRENCIES  = ['ISK', 'EUR'];
const METHODS     = ['code', 'automatic'];
const TYPES       = ['order', 'free_shipping'];

// Returns an array of validation messages (empty = valid). `partial` skips
// required-field checks for fields not present (used by PATCH).
function validateBody(body, { partial = false } = {}) {
  const errors = [];
  const has = (k) => body[k] !== undefined;

  if (!partial || has('code')) {
    if (!body.code || typeof body.code !== 'string' || body.code.trim().length === 0 || body.code.length > 60) {
      errors.push('code is required (max 60 chars)');
    }
  }
  if (!partial || has('value_type')) {
    if (!VALUE_TYPES.includes(body.value_type)) errors.push('value_type must be "percentage" or "fixed"');
  }
  if (!partial || has('value')) {
    const v = Number(body.value);
    if (!Number.isInteger(v) || v < 0) errors.push('value must be a non-negative integer');
    else if (body.value_type === 'percentage' && v > 100) errors.push('percentage value must be between 0 and 100');
  }
  if (has('method') && !METHODS.includes(body.method)) errors.push('method must be "code" or "automatic"');
  if (has('type')   && !TYPES.includes(body.type))     errors.push('type must be "order" or "free_shipping"');
  if (has('currency') && !CURRENCIES.includes(body.currency)) errors.push('currency must be ISK or EUR');
  if (has('min_subtotal') && body.min_subtotal !== null && body.min_subtotal !== '' && (!Number.isInteger(Number(body.min_subtotal)) || Number(body.min_subtotal) < 0)) {
    errors.push('min_subtotal must be a non-negative integer');
  }
  if (has('usage_limit') && body.usage_limit !== null && body.usage_limit !== '' && (!Number.isInteger(Number(body.usage_limit)) || Number(body.usage_limit) < 1)) {
    errors.push('usage_limit must be a positive integer');
  }
  return errors;
}

const adminDiscountController = {
  async list(req, res, next) {
    try {
      const discounts = await Discount.findAll();
      return res.json({ discounts });
    } catch (err) { next(err); }
  },

  async create(req, res, next) {
    try {
      const errors = validateBody(req.body || {});
      if (errors.length) return res.status(400).json({ error: errors[0], code: 400 });
      const discount = await Discount.create(req.body);
      return res.status(201).json({ discount });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A discount with this code already exists', code: 409 });
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const errors = validateBody(req.body || {}, { partial: true });
      if (errors.length) return res.status(400).json({ error: errors[0], code: 400 });
      const discount = await Discount.update(req.params.id, req.body || {});
      if (!discount) return res.status(404).json({ error: 'discount not found', code: 404 });
      return res.json({ discount });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A discount with this code already exists', code: 409 });
      next(err);
    }
  },
};

module.exports = adminDiscountController;
