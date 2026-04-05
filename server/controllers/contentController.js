'use strict';
// Site-content controller — reads/writes rows from the `site_content` table.
// Each row is keyed (e.g. 'home_skills') with a JSONB `value` blob.

const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const db     = require('../config/database');

// ── Image upload: store under public/assets/content/ ─────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'content');
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const key = String(req.params.key || 'content').replace(/[^\w-]/g, '');
    cb(null, `${key}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Unsupported image type'));
    }
    cb(null, true);
  },
}).single('file');

// ── GET /api/v1/content/:key ─────────────────────────────────────────────────
async function getContent(req, res, next) {
  try {
    const { rows } = await db.query(
      'SELECT value FROM site_content WHERE key = $1',
      [req.params.key]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0].value);
  } catch (err) { return next(err); }
}

// ── PUT /api/v1/content/:key ─────────────────────────────────────────────────
async function putContent(req, res, next) {
  try {
    const userId = req.user?.id || null;
    const { rows } = await db.query(
      `INSERT INTO site_content (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING value`,
      [req.params.key, JSON.stringify(req.body), userId]
    );
    return res.json(rows[0].value);
  } catch (err) { return next(err); }
}

// ── POST /api/v1/content/:key/image ──────────────────────────────────────────
function uploadImage(req, res, next) {
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const imageUrl = `/assets/content/${req.file.filename}`;

    try {
      // Merge image_url into the existing JSONB value (or create a new row)
      await db.query(
        `INSERT INTO site_content (key, value, updated_by, updated_at)
         VALUES ($1, jsonb_build_object('image_url', $2::text), $3, NOW())
         ON CONFLICT (key) DO UPDATE
           SET value = site_content.value || jsonb_build_object('image_url', $2::text),
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
        [req.params.key, imageUrl, req.user?.id || null]
      );
      return res.json({ image_url: imageUrl });
    } catch (dbErr) { return next(dbErr); }
  });
}

module.exports = { getContent, putContent, uploadImage };
