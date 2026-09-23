// Row scope for the COMMISSION surface. Use AFTER requireAuth + requireView,
// exactly like accountScope — and note it is NOT accountScope, on purpose.
//
// accountScope returns { all: true } for the `allaccounts` permission, and
// adminAccountRoutes states the intent in its own comment: "`allaccounts`
// widens which ACCOUNTS you see, never which earnings." A role hand-granted
// both `allaccounts` and `commission` would otherwise read every seller's
// rates, amounts and payouts. Nothing exploits it today — the seeded `verktaki`
// holds `allaccounts` and no `commission` view — but the payout screen would
// inherit the same hole, and this is money leaving the company.
//
// So only a true all-access admin ('*') is unscoped here; everyone else sees
// their own. That is strictly NARROWER than what the report route had, which is
// why it is safe to apply to the existing route as well as the new ones.
//
// The MODEL enforces it: CommissionStatement takes the scope as a required
// argument and throws without one, so a route that forgets this middleware
// fails closed rather than open.
const Role = require('../models/Role');
const { ALL } = require('./adminViews');
const { heldRoles } = require('./roles');

async function resolveCommissionScope(req) {
  if (!req._resolvedViews) {
    req._resolvedViews = await Role.getViewsForRoles(heldRoles(req.user));
  }
  return req._resolvedViews.includes(ALL) ? { all: true } : { ownerId: req.user.id };
}

async function commissionScope(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized', code: 401 });
    req.commissionScope = await resolveCommissionScope(req);
    next();
  } catch (err) { next(err); }
}

module.exports = { commissionScope, resolveCommissionScope };
