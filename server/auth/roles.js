// Role-based access control middleware.
// Admin:     read, write, delete, post  (full access)
// Moderator: read, write, post          (no delete)
// User:      read, post                 (view content + post comments/contact)

/**
 * Middleware factory — allows only the listed roles through.
 * Must be used after requireAuth (which sets req.user).
 *
 * @param {...string} roles - One or more of 'admin', 'moderator', 'user'
 */
function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', code: 401 });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', code: 403 });
    }
    next();
  };
}

module.exports = { requireRole };
