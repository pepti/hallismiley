// Roles repository — dynamic role definitions + per-role admin view access.
// The admin role's access is '*' (all views) and getViewsForRole hard-shortcuts
// it, so admins can never be locked out by a bad/edited row. A short TTL cache
// fronts the view-access lookup (requireView runs on every admin request);
// every write invalidates it.
const db = require('../config/database');
const { ALL } = require('../auth/adminViews');

// label (migration 116_role_label): the display name people read; the slug in
// `name` is derived from it on create and never renamed. '' on a role nobody
// named (the UI falls back to the slug; the built-ins are named by i18n).
const COLUMNS = 'name, label, description, view_access, is_system, created_at, updated_at';

// In-process cache (per Node instance). Writes call invalidateCache(), but on a
// multi-instance deploy each process keeps its own map, so a grant change on one
// instance propagates to the others within TTL_MS. Fine at this app's scale.
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

  static async create({ name, label = '', description = '', view_access = [] }) {
    const { rows } = await db.query(
      `INSERT INTO roles (name, label, description, view_access, is_system)
       VALUES ($1, $2, $3, $4::jsonb, FALSE)
       RETURNING ${COLUMNS}`,
      [String(name), String(label || ''), String(description || ''), JSON.stringify(view_access || [])]
    );
    Role.invalidateCache();
    return rows[0];
  }

  // label, description and view_access are mutable; name is the PK / FK target
  // and is never renamed (the controller keeps label off the built-in roles).
  // `client` (optional): run inside the caller's transaction; the caller then
  // invalidates the cache again after COMMIT.
  static async update(name, data, client = db) {
    const sets = [];
    const params = [];
    if (data.label !== undefined) {
      params.push(String(data.label || ''));
      sets.push(`label = $${params.length}`);
    }
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
    const { rows } = await client.query(
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

  // Resolve the UNION of allowed view-ids across a set of role names (multi-role).
  // admin anywhere in the set => ['*'] (every view), short-circuiting the lookups.
  static async getViewsForRoles(names) {
    const list = Array.isArray(names) ? names : [];
    if (list.includes('admin')) return [ALL];
    const set = new Set();
    for (const name of list) {
      const views = await Role.getViewsForRole(name);
      if (views.includes(ALL)) return [ALL]; // defensive — only admin yields ALL
      for (const v of views) set.add(v);
    }
    return [...set];
  }

  static invalidateCache() { _cache.clear(); }
}

module.exports = Role;
