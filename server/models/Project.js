// Repository pattern — all SQL lives here, controllers stay clean
// Parameterised queries throughout (A03: prevents SQL injection)
const db = require('../config/database');

// Explicit column list — avoids SELECT * so schema changes are explicit
const COLUMNS = 'id, title, description, category, year, tools_used, image_url, featured, created_at, updated_at';

class Project {
  // ── READ ──────────────────────────────────────────────────────────────────

  static async findAll(filters = {}) {
    const { category, featured, year, limit = 20, offset = 0 } = filters;
    const conditions = [];
    const params     = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (featured !== undefined) {
      params.push(featured === 'true' || featured === true);
      conditions.push(`featured = $${params.length}`);
    }
    if (year) {
      params.push(Number(year));
      conditions.push(`year = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Append LIMIT and OFFSET params after filter params
    params.push(Number(limit));
    params.push(Number(offset));

    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM projects ${where} ORDER BY year DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows;
  }

  static async findById(id) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM projects WHERE id = $1`,
      [Number(id)]
    );
    return rows[0] || null;
  }

  static async findFeatured() {
    return Project.findAll({ featured: 'true' });
  }

  // ── WRITE ─────────────────────────────────────────────────────────────────

  static async create(data) {
    const { title, description, category, year, tools_used = [], image_url = null, featured = false } = data;
    const { rows } = await db.query(
      `INSERT INTO projects (title, description, category, year, tools_used, image_url, featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [title, description, category, Number(year), tools_used, image_url, Boolean(featured)]
    );
    return rows[0];
  }

  static async update(id, data) {
    // Build SET clause dynamically — only update provided fields
    const allowed = ['title', 'description', 'category', 'year', 'tools_used', 'image_url', 'featured'];
    const sets   = [];
    const params = [];

    for (const field of allowed) {
      if (data[field] !== undefined) {
        params.push(field === 'year' ? Number(data[field]) : data[field]);
        sets.push(`${field} = $${params.length}`);
      }
    }

    if (sets.length === 0) return Project.findById(id); // nothing to update

    params.push(Number(id));
    const { rows } = await db.query(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params
    );
    return rows[0] || null;
  }

  static async delete(id) {
    const { rowCount } = await db.query(
      'DELETE FROM projects WHERE id = $1',
      [Number(id)]
    );
    return rowCount > 0;
  }
}

module.exports = Project;
