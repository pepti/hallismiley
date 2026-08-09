// User↔role membership (many-to-many). `user_roles` is the source of truth for the
// SET of roles a user holds; users.role remains a denormalized "primary" role
// (display + sane defaults at the user-INSERT sites + the floor). Effective
// permissions are the UNION across all of a user's roles (see Role.getViewsForRoles).
//
// A short per-user TTL cache fronts listForUser() because requireAuth resolves the
// set on every authenticated request; every write invalidates the affected user.
// Like the Role cache, on a multi-instance deploy each process keeps its own map,
// so a change on one instance propagates to the others within TTL_MS.
const db = require('../config/database');

// Precedence for choosing a user's primary role (users.role) when their current
// primary membership is removed: admin > moderator > any custom role (alpha) > user.
function rolePriority(name) {
  if (name === 'admin')     return 0;
  if (name === 'moderator') return 1;
  if (name === 'user')      return 3;
  return 2; // custom roles sit between moderator and the 'user' floor
}

const _cache = new Map(); // userId -> { roles: string[], exp: epoch-ms }
const TTL_MS = 30_000;

const UserRole = {
  // Full role set for a user (cached). Callers that need a guaranteed-non-empty set
  // (permission checks) should floor to the user's primary role themselves.
  async listForUser(userId) {
    const key = String(userId);
    const hit = _cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.roles;
    const { rows } = await db.query(
      'SELECT role_name FROM user_roles WHERE user_id = $1 ORDER BY role_name',
      [key]
    );
    const roles = rows.map(r => r.role_name);
    _cache.set(key, { roles, exp: Date.now() + TTL_MS });
    return roles;
  },

  // Add a membership (idempotent). Returns true if a new row was inserted.
  async add(userId, roleName, grantedBy = null) {
    const { rowCount } = await db.query(
      `INSERT INTO user_roles (user_id, role_name, granted_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [String(userId), String(roleName), grantedBy ? String(grantedBy) : null]
    );
    UserRole.invalidateUser(userId);
    return rowCount > 0;
  },

  // Remove a membership. Returns true if a row was deleted.
  async remove(userId, roleName) {
    const { rowCount } = await db.query(
      'DELETE FROM user_roles WHERE user_id = $1 AND role_name = $2',
      [String(userId), String(roleName)]
    );
    UserRole.invalidateUser(userId);
    return rowCount > 0;
  },

  // All members grouped by role (for the admin "Members" board). One JOIN query.
  // Returns Map<role_name, user[]>; roles with no members simply won't be keys, so
  // callers that need every role as a column should start from Role.findAll().
  async membersByRole() {
    const { rows } = await db.query(
      `SELECT ur.role_name,
              u.id, u.username, u.display_name, u.email, u.avatar, u.disabled,
              (u.role = ur.role_name) AS is_primary
         FROM user_roles ur
         JOIN users u ON u.id = ur.user_id
        ORDER BY ur.role_name, u.display_name NULLS LAST, u.username`
    );
    const map = new Map();
    for (const r of rows) {
      const { role_name, ...user } = r;
      if (!map.has(role_name)) map.set(role_name, []);
      map.get(role_name).push(user);
    }
    return map;
  },

  // Distinct non-disabled users who hold the 'admin' role — the last-admin guard
  // must consider membership, not just users.role.
  async adminCount() {
    const { rows } = await db.query(
      `SELECT COUNT(DISTINCT ur.user_id)::int AS n
         FROM user_roles ur
         JOIN users u ON u.id = ur.user_id
        WHERE ur.role_name = 'admin' AND u.disabled = FALSE`
    );
    return rows[0].n;
  },

  // Highest-precedence role from a set, floored to 'user' — the new primary
  // (users.role) after the current primary membership is removed.
  pickPrimary(roles) {
    if (!roles || !roles.length) return 'user';
    return [...roles].sort((a, b) => rolePriority(a) - rolePriority(b))[0];
  },

  invalidateUser(userId) { _cache.delete(String(userId)); },
  invalidateAll() { _cache.clear(); },
};

module.exports = UserRole;
