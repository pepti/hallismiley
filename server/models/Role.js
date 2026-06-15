// Roles repository — dynamic role definitions + per-role admin view access.
// The admin role's access is '*' (all views) and getViewsForRole hard-shortcuts
// it, so admins can never be locked out by a bad/edited row. A short TTL cache
// fronts the view-access lookup (requireView runs on every admin request);
// every write invalidates it.
const db = require('../config/database');
const { ALL } = require('../auth/adminViews');

const COLUMNS = 'name, description, view_access, is_system, created_at, updated_at';

const _cache  = new Map(); // name -> { views: string[], exp: epoch-ms }
const TTL_MS  = 30_000;

class Role {
  static async findAll() {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM roles ORDER BY is_system DESC, name ASC`
    );
    return rows;
  }

  static async findByName(name) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM roles WHERE name = $1`,
      [String(name)]
    );
    return rows[0] || null;
  }

  static async create({ name, description = '', view_access = [] }) {
    const { rows } = await db.query(
      `INSERT INTO roles (name, description, view_access, is_system)
       VALUES ($1, $2, $3::jsonb, FALSE)
       RETURNING ${COLUMNS}`,
      [String(name), String(description || ''), JSON.stringify(view_access || [])]
    );
    Role.invalidateCache();
    return rows[0];
  }

  // Only description + view_access are mutable (name is the PK / FK target).
  static async update(name, data) {
    const sets = [];
    const params = [];
    if (data.description !== undefined) {
      params.push(String(data.description || ''));
      sets.push(`description = $${params.length}`);
    }
    if (data.view_access !== undefined) {
      params.push(JSON.stringify(data.view_access || []));
      sets.push(`view_access = $${params.length}::jsonb`);
    }
    if (sets.length === 0) return Role.findByName(name);
    params.push(String(name));
    const { rows } = await db.query(
      `UPDATE roles SET ${sets.join(', ')} WHERE name = $${params.length} RETURNING ${COLUMNS}`,
      params
    );
    Role.invalidateCache();
    return rows[0] || null;
  }

  static async remove(name) {
    const { rows } = await db.query(
      `DELETE FROM roles WHERE name = $1 RETURNING name`,
      [String(name)]
    );
    Role.invalidateCache();
    return rows[0] || null;
  }

  // Resolve allowed view-ids for a role name. admin => ['*'] without a query so a
  // corrupted admin row can never lock admins out. Cached with a short TTL.
  static async getViewsForRole(name) {
    if (name === 'admin') return [ALL];
    const hit = _cache.get(name);
    if (hit && hit.exp > Date.now()) return hit.views;
    const row = await Role.findByName(name);
    const views = (row && Array.isArray(row.view_access)) ? row.view_access : [];
    _cache.set(name, { views, exp: Date.now() + TTL_MS });
    return views;
  }

  static invalidateCache() { _cache.clear(); }
}

module.exports = Role;
