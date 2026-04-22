'use strict';
// Site-content controller — reads/writes rows from the `site_content` table.
// Since migration 029 each row is keyed by (key, locale).
// GET falls back to DEFAULT_LOCALE if no row exists for the requested locale.

const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const db     = require('../config/database');
const { MIME_TO_EXT } = require('../middleware/upload');
const { DEFAULT_LOCALE } = require('../config/i18n');

// ── Image upload: store under public/assets/content/ ─────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'content');
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || '.jpg';
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
// Locale fallback: tries req.locale first, then DEFAULT_LOCALE.
async function getContent(req, res, next) {
  try {
    const locale = req.locale || DEFAULT_LOCALE;
    const { rows } = await db.query(
      `SELECT value FROM site_content
        WHERE key = $1 AND locale = $2
        UNION ALL
       SELECT value FROM site_content
        WHERE key = $1 AND locale = $3
        LIMIT 1`,
      [req.params.key, locale, DEFAULT_LOCALE]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0].value);
  } catch (err) { return next(err); }
}

// ── PUT /api/v1/content/:key ─────────────────────────────────────────────────
// Accepts an optional ?locale= query param to target a specific locale.
async function putContent(req, res, next) {
  try {
    const locale = req.query.locale || req.locale || DEFAULT_LOCALE;
    const userId = req.user?.id || null;
    const { rows } = await db.query(
      `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (key, locale) DO UPDATE
         SET value      = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING value`,
      [req.params.key, locale, JSON.stringify(req.body), userId]
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
    const merge    = req.query.merge !== 'false';
    const locale   = req.query.locale || req.locale || DEFAULT_LOCALE;

    if (!merge) return res.json({ image_url: imageUrl });

    try {
      await db.query(
        `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
         VALUES ($1, $2, jsonb_build_object('image_url', $3::text), $4, NOW())
         ON CONFLICT (key, locale) DO UPDATE
           SET value      = site_content.value || jsonb_build_object('image_url', $3::text),
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
        [req.params.key, locale, imageUrl, req.user?.id || null]
      );
      return res.json({ image_url: imageUrl });
    } catch (dbErr) { return next(dbErr); }
  });
}

module.exports = { getContent, putContent, uploadImage };
