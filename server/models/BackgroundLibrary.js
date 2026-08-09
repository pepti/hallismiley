'use strict';
// Background media library — data access for the flat global library that backs
// the admin-configurable home-hero background. One flat list (no sections —
// this site's hero is a single video/photo, not a tiled mosaic).
const db = require('../config/database');

const MEDIA_COLUMNS = 'id, file_path, media_type, caption, caption_is, sort_order, created_at';

async function listMedia() {
  const { rows } = await db.query(
    `SELECT ${MEDIA_COLUMNS} FROM background_media ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

async function mediaById(id) {
  const { rows } = await db.query(
    `SELECT ${MEDIA_COLUMNS} FROM background_media WHERE id = $1`, [id]
  );
  return rows[0] || null;
}

async function addMedia({ file_path, media_type, caption = null, caption_is = null }) {
  // Append to the end of the library.
  const { rows } = await db.query(
    `INSERT INTO background_media (file_path, media_type, caption, caption_is, sort_order)
     VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM background_media), 0))
     RETURNING ${MEDIA_COLUMNS}`,
    [file_path, media_type, caption, caption_is]
  );
  return rows[0];
}

async function updateMedia(id, patch) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const col of ['caption', 'caption_is']) {
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
  // order: [{ id, sort_order }]
  const ids = order.map((o) => Number(o.id));
  const { rows: existing } = await db.query(
    'SELECT id FROM background_media WHERE id = ANY($1::int[])', [ids]
  );
  if (existing.length !== ids.length) {
    const err = new Error('Media does not exist'); err.code = 'BAD_INPUT'; throw err;
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const o of order) {
      await client.query('UPDATE background_media SET sort_order = $1 WHERE id = $2', [o.sort_order, o.id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK'); throw err;
  } finally {
    client.release();
  }
  return listMedia();
}

module.exports = { listMedia, mediaById, addMedia, updateMedia, deleteMedia, reorderMedia };
