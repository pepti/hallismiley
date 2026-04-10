// Repository pattern — all SQL lives here, controllers stay clean
// Parameterised queries throughout (A03: prevents SQL injection)
const db = require('../config/database');

// Explicit column list — avoids SELECT * so schema changes are explicit
const COLUMNS = 'id, title, description, category, year, tools_used, image_url, featured, video_section_position, created_at, updated_at';

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
    const allowed = ['title', 'description', 'category', 'year', 'tools_used', 'image_url', 'featured', 'video_section_position'];
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

const SECTION_COLUMNS = 'id, project_id, name, description, sort_order, created_at';

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

  static async create(projectId, name, description = null) {
    // New section goes to the end
    const { rows: maxRows } = await db.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
         FROM project_sections WHERE project_id = $1`,
      [Number(projectId)]
    );
    const nextOrder = maxRows[0].next;

    const { rows } = await db.query(
      `INSERT INTO project_sections (project_id, name, description, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING ${SECTION_COLUMNS}`,
      [Number(projectId), name, description, nextOrder]
    );
    return rows[0];
  }

  // Partial update — any of { name, description } may be provided
  static async update(projectId, sectionId, { name, description }) {
    const sets = [];
    const params = [];
    if (name !== undefined) {
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (description !== undefined) {
      params.push(description);
      sets.push(`description = $${params.length}`);
    }
    if (sets.length === 0) {
      // Nothing to change — return current row
      const { rows } = await db.query(
        `SELECT ${SECTION_COLUMNS} FROM project_sections WHERE id = $1 AND project_id = $2`,
        [Number(sectionId), Number(projectId)]
      );
      return rows[0] || null;
    }
    params.push(Number(sectionId));
    params.push(Number(projectId));
    const { rows } = await db.query(
      `UPDATE project_sections
          SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND project_id = $${params.length}
      RETURNING ${SECTION_COLUMNS}`,
      params
    );
    return rows[0] || null;
  }

  // Backwards-compat alias used by older controller references
  static async rename(projectId, sectionId, name) {
    return ProjectSection.update(projectId, sectionId, { name });
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

// ── Project videos (files + YouTube embeds) ──────────────────────────────────

const VIDEO_COLUMNS = 'id, project_id, kind, file_path, youtube_id, title, sort_order, created_at';

class ProjectVideo {
  static async list(projectId) {
    const { rows } = await db.query(
      `SELECT ${VIDEO_COLUMNS}
         FROM project_videos
        WHERE project_id = $1
        ORDER BY sort_order ASC, id ASC`,
      [Number(projectId)]
    );
    return rows;
  }

  static async create(projectId, { kind, file_path, youtube_id, title }) {
    // Next sort_order
    const { rows: maxRows } = await db.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
         FROM project_videos WHERE project_id = $1`,
      [Number(projectId)]
    );
    const nextOrder = maxRows[0].next;

    const { rows } = await db.query(
      `INSERT INTO project_videos (project_id, kind, file_path, youtube_id, title, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${VIDEO_COLUMNS}`,
      [Number(projectId), kind, file_path || null, youtube_id || null, title || null, nextOrder]
    );
    return rows[0];
  }

  static async update(projectId, videoId, { title }) {
    const sets = [];
    const params = [];
    if (title !== undefined) {
      params.push(title);
      sets.push(`title = $${params.length}`);
    }
    if (sets.length === 0) {
      const { rows } = await db.query(
        `SELECT ${VIDEO_COLUMNS} FROM project_videos WHERE id = $1 AND project_id = $2`,
        [Number(videoId), Number(projectId)]
      );
      return rows[0] || null;
    }
    params.push(Number(videoId));
    params.push(Number(projectId));
    const { rows } = await db.query(
      `UPDATE project_videos SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND project_id = $${params.length}
      RETURNING ${VIDEO_COLUMNS}`,
      params
    );
    return rows[0] || null;
  }

  static async reorder(projectId, order) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of order) {
        await client.query(
          `UPDATE project_videos SET sort_order = $1
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
    return ProjectVideo.list(projectId);
  }

  static async delete(projectId, videoId) {
    const { rows } = await db.query(
      `DELETE FROM project_videos WHERE id = $1 AND project_id = $2
       RETURNING kind, file_path`,
      [Number(videoId), Number(projectId)]
    );
    return rows[0] || null;
  }

  static async deleteAll(projectId) {
    // Returns the deleted rows so callers can unlink any file_path from disk
    const { rows } = await db.query(
      `DELETE FROM project_videos WHERE project_id = $1
       RETURNING kind, file_path`,
      [Number(projectId)]
    );
    return rows;
  }
}

module.exports = Project;
module.exports.ProjectSection = ProjectSection;
module.exports.ProjectVideo   = ProjectVideo;
