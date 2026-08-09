// Role-based access control middleware.
// Admin:     read, write, delete, post  (full access)
// Moderator: read, write, post          (no delete)
// User:      read, post                 (view content + post comments/contact)

/**
 * Middleware factory — allows a user through if ANY of their roles is listed.
 * Must be used after requireAuth (which sets req.user + req.user.roles).
 * Multi-role: req.user.roles is the full set; falls back to the primary role.
 *
 * @param {...string} roles - One or more of 'admin', 'moderator', 'user', or a custom role
 */
function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', code: 401 });
    }
    const held = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role];
    if (!roles.some(r => held.includes(r))) {
      return res.status(403).json({ error: 'Forbidden', code: 403 });
    }
    next();
  };
}

module.exports = { requireRole };
