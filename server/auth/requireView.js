// Per-admin-view authorization. Use AFTER requireAuth (which sets req.user).
// The admin role is allowed every view (Role.getViewsForRoles shortcuts to ['*']),
// so admins can never be locked out — even by a corrupted roles.admin row.
// Multi-role: views are the UNION across the user's full role set (req.user.roles).
// Resolved views are memoised on req so multiple requireView() guards on one
// request resolve the set only once.
const Role = require('../models/Role');
const { ALL } = require('./adminViews');

function requireView(viewId) {
  return async function viewGuard(req, res, next) {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized', code: 401 });
      if (!req._resolvedViews) {
        const held = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role];
        req._resolvedViews = await Role.getViewsForRoles(held);
      }
      const views = req._resolvedViews;
      if (views.includes(ALL) || views.includes(viewId)) return next();
      return res.status(403).json({ error: 'Forbidden', code: 403 });
    } catch (err) { next(err); }
  };
}

module.exports = { requireView };
