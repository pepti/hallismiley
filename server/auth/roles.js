// Role-based access control middleware.
// Admin:     read, write, delete, post  (full access)
// Moderator: read, write, post          (no delete)
// User:      read, post                 (view content + post comments/contact)

// The role SET (req.user.roles, attached by auth/middleware.js attachRoles) is
// the authoritative source for every permission decision; users.role is only
// the denormalized primary, and an admin granted through Admin → Roles never
// has it updated. The fallback to the primary exists for a user object that
// predates attachRoles — none today, since every auth middleware attaches the
// set — so a caller handed a raw user row still gets the right answer.
//
// THIS is where that rule lives. It used to be spelled out in four places
// (requireRole, requireView, adminCustomerNoteController, and the change-
// request gate) — one more copy per gate, each a place the rule could drift.
function heldRoles(user) {
  if (!user) return [];
  return Array.isArray(user.roles) ? user.roles : [user.role];
}

function hasRole(user, ...names) {
  const held = heldRoles(user);
  return names.some(r => held.includes(r));
}

/**
 * Middleware factory — allows a user through if ANY of their roles is listed.
 * Must be used after requireAuth (which sets req.user + req.user.roles).
 *
 * @param {...string} roles - One or more of 'admin', 'moderator', 'user', or a custom role
 */
function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized', code: 401 });
    }
    if (!hasRole(req.user, ...roles)) {
      return res.status(403).json({ error: 'Forbidden', code: 403 });
    }
    next();
  };
}

module.exports = { requireRole, heldRoles, hasRole };
