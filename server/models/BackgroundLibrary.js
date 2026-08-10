'use strict';
// Background media library — data access for the global library that backs the
// admin-configurable home-hero background. Media may be grouped into named
// sections (migration 080) or left ungrouped; the hero itself is still a single
// video/photo/plain choice, so sections are purely a library-organisation tool.
//
// Ordering is (section_id NULLS FIRST, sort_order, id) so the ungrouped bucket
// sorts first, matching what the admin UI paints. Reorder is a batched
// transaction; deleting a section nulls its media's section_id rather than
// cascading, so uploads survive.
const db = require('../config/database');

const MEDIA_COLUMNS   = 'id, section_id, file_path, media_type, caption, caption_is, sort_order, created_at';
const SECTION_COLUMNS = 'id, name, name_is, description, description_is, sort_order, created_at';

// ── Sections ─────────────────────────────────────────────────────────────────
async function listSections() {
  const { rows } = await db.query(
    `SELECT ${SECTION_COLUMNS} FROM background_sections ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

async function sectionById(id) {
  const { rows } = await db.query(
    `SELECT ${SECTION_COLUMNS} FROM background_sections WHERE id = $1`, [id]
  );
  return rows[0] || null;
}

async function createSection({ name, name_is = null, description = null, description_is = null }) {
  // New sections go to the end.
  const { rows } = await db.query(
    `INSERT INTO background_sections (name, name_is, description, description_is, sort_order)
     VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM background_sections), 0))
     RETURNING ${SECTION_COLUMNS}`,
    [name, name_is, description, description_is]
  );
  return rows[0];
}

async function updateSection(id, patch) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const col of ['name', 'name_is', 'description', 'description_is']) {
    if (patch[col] !== undefined) { sets.push(`${col} = $${i++}`); vals.push(patch[col]); }
  }
  if (!sets.length) return sectionById(id);
  vals.push(id);
  const { rows } = await db.query(
    `UPDATE background_sections SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${SECTION_COLUMNS}`,
    vals
  );
  return rows[0] || null;
}

async function deleteSection(id) {
  // ON DELETE SET NULL on background_media.section_id ungroups the media.
  const { rowCount } = await db.query('DELETE FROM background_sections WHERE id = $1', [id]);
  return rowCount > 0;
}

async function reorderSections(order) {
  // order: [{ id, sort_order }]
  const ids = order.map((o) => Number(o.id));
  const { rows: existing } = await db.query(
    'SELECT id FROM background_sections WHERE id = ANY($1::int[])', [ids]
  );
  if (existing.length !== ids.length) {
    const err = new Error('Section does not exist'); err.code = 'BAD_INPUT'; throw err;
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const o of order) {
      await client.query('UPDATE background_sections SET sort_order = $1 WHERE id = $2', [o.sort_order, o.id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally {
    client.release();
  }
  return listSections();
}

// ── Media ────────────────────────────────────────────────────────────────────
async function listMedia() {
  const { rows } = await db.query(
    `SELECT ${MEDIA_COLUMNS} FROM background_media
      ORDER BY section_id ASC NULLS FIRST, sort_order ASC, id ASC`
  );
  return rows;
}

async function mediaById(id) {
  const { rows } = await db.query(
    `SELECT ${MEDIA_COLUMNS} FROM background_media WHERE id = $1`, [id]
  );
  return rows[0] || null;
}

async function addMedia({ file_path, media_type, section_id = null, caption = null, caption_is = null }) {
  // Append to the end of its section (or of the ungrouped bucket).
  const { rows } = await db.query(
    `INSERT INTO background_media (file_path, media_type, section_id, caption, caption_is, sort_order)
     VALUES ($1, $2, $3, $4, $5,
       COALESCE((SELECT MAX(sort_order) + 1 FROM background_media
                  WHERE section_id IS NOT DISTINCT FROM $3), 0))
     RETURNING ${MEDIA_COLUMNS}`,
    [file_path, media_type, section_id, caption, caption_is]
  );
  return rows[0];
}

async function updateMedia(id, patch) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const col of ['caption', 'caption_is', 'section_id']) {
    if (patch[col] !== undefined) { sets.push(`${col} = $${i++}`); vals.push(patch[col]); }
  }
  if (!sets.length) return mediaById(id);
  vals.push(id);
  const { rows } = await db.query(
    `UPDATE background_media SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${MEDIA_COLUMNS}`,
    vals
  );
  return rows[0] || null;
}

async function deleteMedia(id) {
  const { rows } = await db.query(
    'DELETE FROM background_media WHERE id = $1 RETURNING file_path', [id]
  );
  return rows[0] || null; // { file_path } or null
}

async function reorderMedia(order) {
  // order: [{ id, sort_order, section_id? }]. section_id may be null (ungroup).
  const ids = order.map((o) => Number(o.id));
  const { rows: existing } = await db.query(
    'SELECT id FROM background_media WHERE id = ANY($1::int[])', [ids]
  );
  if (existing.length !== ids.length) {
    const err = new Error('Media does not exist'); err.code = 'BAD_INPUT'; throw err;
  }
  // Any supplied section_id must be a real section — a bad one would otherwise
  // blow up mid-transaction on the FK.
  const sectionIds = [...new Set(
    order.filter((o) => o.section_id !== undefined && o.section_id !== null).map((o) => Number(o.section_id))
  )];
  if (sectionIds.length) {
    const { rows: secs } = await db.query(
      'SELECT id FROM background_sections WHERE id = ANY($1::int[])', [sectionIds]
    );
    if (secs.length !== sectionIds.length) {
      const err = new Error('Section does not exist'); err.code = 'BAD_INPUT'; throw err;
    }
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const o of order) {
      if (o.section_id !== undefined) {
        const sid = o.section_id === null ? null : Number(o.section_id);
        await client.query(
          'UPDATE background_media SET sort_order = $1, section_id = $2 WHERE id = $3',
          [o.sort_order, sid, o.id]
        );
      } else {
        await client.query('UPDATE background_media SET sort_order = $1 WHERE id = $2', [o.sort_order, o.id]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally {
    client.release();
  }
  return listMedia();
}

module.exports = {
  listSections, sectionById, createSection, updateSection, deleteSection, reorderSections,
  listMedia, mediaById, addMedia, updateMedia, deleteMedia, reorderMedia,
};
