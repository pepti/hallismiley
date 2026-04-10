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

// ── Project sections (named gallery groups) ──────────────────────────────────

const SECTION_COLUMNS = 'id, project_id, name, sort_order, created_at';

class ProjectSection {
  static async list(projectId) {
    const { rows } = await db.query(
      `SELECT ${SECTION_COLUMNS}
         FROM project_sections
        WHERE project_id = $1
        ORDER BY sort_order ASC, id ASC`,
      [Number(projectId)]
    );
    return rows;
  }

  static async create(projectId, name) {
    // New section goes to the end
    const { rows: maxRows } = await db.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
         FROM project_sections WHERE project_id = $1`,
      [Number(projectId)]
    );
    const nextOrder = maxRows[0].next;

    const { rows } = await db.query(
      `INSERT INTO project_sections (project_id, name, sort_order)
       VALUES ($1, $2, $3)
       RETURNING ${SECTION_COLUMNS}`,
      [Number(projectId), name, nextOrder]
    );
    return rows[0];
  }

  static async rename(projectId, sectionId, name) {
    const { rows } = await db.query(
      `UPDATE project_sections
          SET name = $1
        WHERE id = $2 AND project_id = $3
      RETURNING ${SECTION_COLUMNS}`,
      [name, Number(sectionId), Number(projectId)]
    );
    return rows[0] || null;
  }

  static async reorder(projectId, order) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of order) {
        await client.query(
          `UPDATE project_sections
              SET sort_order = $1
            WHERE id = $2 AND project_id = $3`,
          [Number(item.sort_order), Number(item.id), Number(projectId)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return ProjectSection.list(projectId);
  }

  static async delete(projectId, sectionId) {
    // ON DELETE SET NULL on project_media.section_id preserves media
    const { rowCount } = await db.query(
      `DELETE FROM project_sections WHERE id = $1 AND project_id = $2`,
      [Number(sectionId), Number(projectId)]
    );
    return rowCount > 0;
  }
}

module.exports = Project;
module.exports.ProjectSection = ProjectSection;
