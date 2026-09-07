// Row scope for customer accounts (and the commission report). Use AFTER
// requireAuth + requireView: it reads the views requireView memoised on the
// request and decides whether the caller sees every account or only their
// own. The MODEL enforces the scope — every CustomerAccount method takes it as
// a required argument and appends `owner_user_id = $n` unless it says `all`,
// so a route that forgot this middleware fails closed (the model throws on a
// missing scope) rather than open.
//
//   admin ('*') or the `allaccounts` permission → { all: true }
//   anyone else                                 → { ownerId: req.user.id }
const Role = require('../models/Role');
const { ALL } = require('./adminViews');
const { heldRoles } = require('./roles');

const UNSCOPED_VIEW = 'allaccounts';

async function resolveScope(req) {
  if (!req._resolvedViews) {
    req._resolvedViews = await Role.getViewsForRoles(heldRoles(req.user));
  }
  const views = req._resolvedViews;
  if (views.includes(ALL) || views.includes(UNSCOPED_VIEW)) return { all: true };
  return { ownerId: req.user.id };
}

async function accountScope(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized', code: 401 });
    req.accountScope = await resolveScope(req);
    next();
  } catch (err) { next(err); }
}

module.exports = { accountScope, resolveScope, UNSCOPED_VIEW };
