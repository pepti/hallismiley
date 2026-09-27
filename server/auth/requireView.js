// Per-admin-view authorization. Use AFTER requireAuth (which sets req.user).
// The admin role is allowed every view (Role.getViewsForRoles shortcuts to ['*']),
// so admins can never be locked out — even by a corrupted roles.admin row.
// Multi-role: views are the UNION across the user's full role set (req.user.roles).
// Resolved views are memoised on req so multiple requireView() guards on one
// request resolve the set only once.
//
// Two-factor policy (auth/mfaPolicy.js): an `accounts` holder who has not
// enrolled a second factor has that view — and a wildcard grant — withheld
// here, the one place views are resolved for a guard. An unenrolled ADMIN
// never gets this far as one: attachRoles already stripped `admin` from the
// role set the views are resolved from.
const Role = require('../models/Role');
const { ALL } = require('./adminViews');
const { heldRoles, hasRole, forbiddenMessage } = require('./roles');
const { withholdViews } = require('./mfaPolicy');

// The view list a guard decides on: the union across the role set, memoised
// on req, with the 2FA-withheld views taken out. Exported so a handler that
// computes per-view blocks (the admin home, routes/adminHomeRoutes.js) asks
// the SAME question the guards ask — never a second resolver that could
// disagree with them.
async function resolveViews(req) {
  if (!req._resolvedViews) {
    req._resolvedViews = await Role.getViewsForRoles(heldRoles(req.user));
  }
  return withholdViews(req._resolvedViews, req.user.mfaEnrolmentRequired === true);
}

function requireView(viewId) {
  return async function viewGuard(req, res, next) {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized', code: 401 });
      const views = await resolveViews(req);
      if (views.includes(ALL) || views.includes(viewId)) return next();
      return res.status(403).json({ error: forbiddenMessage(req), code: 403 });
    } catch (err) { next(err); }
  };
}

// The ONE outer door on /api/v1/admin (app.js, harvested from ice #418): a
// signed-in account with staff standing — admin or moderator, or any role that
// grants at least one admin view (a seller, a contractor, a custom role). Every
// admin router behind it still carries its own, usually narrower, guard; this
// only guarantees that a router which forgets one is still closed to plain
// customer accounts. Ice keys it on admin + moderator; the engine's dynamic
// roles make any view holder staff. Same memoised, MFA-withheld view set as
// requireView, so the two can never disagree about who is in.
async function requireStaff(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized', code: 401 });
    if (hasRole(req.user, 'admin', 'moderator')) return next();
    const views = await resolveViews(req);
    if (views.length > 0) return next();
    return res.status(403).json({ error: forbiddenMessage(req), code: 403 });
  } catch (err) { next(err); }
}

module.exports = { requireView, requireStaff, resolveViews };
