// CustomerNote repository — a categorized, staff-authored note LOG about a shop
// customer (order preferences, how they order, special needs, general). Notes
// attach to the customer's user row (B2C — no companies). Per-note visibility
// ('admin' = admins only, 'staff' = anyone holding the grantable 'customers'
// view) is enforced here AND in the controller; customers themselves never
// reach this layer.
const db = require('../config/database');

// Author display resolves live from users, falling back to the stored snapshot so
// a note survives the author being deleted (author_id ON DELETE SET NULL).
const NOTE_SELECT = `
  cn.id, cn.user_id, cn.category, cn.body, cn.visibility,
  cn.author_id, cn.author_name, cn.created_at, cn.updated_at,
  COALESCE(u.display_name, u.email, cn.author_name) AS author_display`;

class CustomerNote {
  // Which note visibilities a viewer may see, from their full role set. Single
  // source of truth for the read filter + write-authorization scope. Anyone who
  // reached the router holds the 'customers' view, so non-admins get 'staff'.
  static visibilitiesForRoles(roles) {
    const held = Array.isArray(roles) ? roles : [roles];
    return held.includes('admin') ? ['admin', 'staff'] : ['staff'];
  }

  // Resolve the note owner for a customer (users.id, role='user'). null when the
  // id isn't a customer — staff/admin accounts don't take customer notes.
  static async ownerForCustomer(customerId) {
    const { rows } = await db.query(
      `SELECT 1 FROM users WHERE id = $1 AND role = 'user'`,
      [String(customerId)]
    );
    return rows[0] ? { userId: String(customerId) } : null;
  }

  // Notes for one customer, newest first, filtered to what the viewer may see.
  static async listForOwner({ userId = null } = {}, viewerRoles) {
    if (!userId) return [];
    const vis = this.visibilitiesForRoles(viewerRoles);
    const { rows } = await db.query(
      `SELECT ${NOTE_SELECT}
         FROM customer_notes cn
         LEFT JOIN users u ON u.id = cn.author_id
        WHERE cn.user_id = $1
          AND cn.visibility = ANY($2::text[])
        ORDER BY cn.created_at DESC`,
      [String(userId), vis]
    );
    return rows;
  }

  // Fetch one note (with author display, no visibility filter) — used by the
  // controller's pre-check and to echo back a freshly written row.
  static async findById(id) {
    const { rows } = await db.query(
      `SELECT ${NOTE_SELECT}
         FROM customer_notes cn
         LEFT JOIN users u ON u.id = cn.author_id
        WHERE cn.id = $1`,
      [String(id)]
    );
    return rows[0] || null;
  }

  static async create({ userId, category = 'general', body, visibility = 'admin', authorId = null, authorName = null }) {
    const { rows } = await db.query(
      `INSERT INTO customer_notes (user_id, category, body, visibility, author_id, author_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        String(userId), String(category), String(body), String(visibility),
        authorId ? String(authorId) : null,
        authorName == null ? null : String(authorName),
      ]
    );
    return this.findById(rows[0].id);
  }

  // Edit a note. The WHERE re-applies the viewer's visibility scope so the data
  // layer itself blocks touching a note the viewer can't see (defense in depth;
  // the controller also pre-checks + guards non-admin→admin promotion). null → 404.
  static async update(id, { category, body, visibility } = {}, viewerRoles) {
    const vis = this.visibilitiesForRoles(viewerRoles);
    const { rows } = await db.query(
      `UPDATE customer_notes
          SET category   = COALESCE($2, category),
              body       = COALESCE($3, body),
              visibility = COALESCE($4, visibility)
        WHERE id = $1 AND visibility = ANY($5::text[])
        RETURNING id`,
      [String(id), category ?? null, body ?? null, visibility ?? null, vis]
    );
    if (!rows[0]) return null;
    return this.findById(id);
  }

  static async remove(id, viewerRoles) {
    const vis = this.visibilitiesForRoles(viewerRoles);
    const { rows } = await db.query(
      `DELETE FROM customer_notes WHERE id = $1 AND visibility = ANY($2::text[]) RETURNING id`,
      [String(id), vis]
    );
    return rows[0] || null;
  }
}

module.exports = CustomerNote;
