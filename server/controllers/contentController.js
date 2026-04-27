'use strict';
// Site-content controller — reads/writes rows from the `site_content` table.
// Since migration 029 each row is keyed by (key, locale).
// GET falls back to DEFAULT_LOCALE if no row exists for the requested locale.

const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const db     = require('../config/database');
const logger = require('../logger');
const { MIME_TO_EXT } = require('../middleware/upload');
const { DEFAULT_LOCALE } = require('../config/i18n');
const { t }   = require('../i18n');
const { translateTree, isEnabled: translatorEnabled } = require('../services/translator');

// Keys on site_content that should NEVER auto-fill their IS sibling row
// (e.g. rows that are intentionally locale-neutral, like footer link lists
// or tech pills). Start empty; extend if admins report noise.
const SITE_CONTENT_TRANSLATE_SKIP = new Set([]);

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
    if (rows.length === 0) return res.status(404).json({ error: t(req.locale, 'errors.content.notFound') });
    return res.json(rows[0].value);
  } catch (err) { return next(err); }
}

// Shallow-merge EN translations into an existing IS tree — only string leaves
// whose IS counterpart is null/undefined/empty get filled. Keys that are in
// the translator's BLOCK_KEYS list are already excluded by `translateTree`.
// Falls back to the translated EN tree when no IS row exists yet.
function mergeTranslatedTree(translatedEn, existingIs) {
  if (existingIs === null || existingIs === undefined) return translatedEn;
  if (Array.isArray(translatedEn)) {
    if (!Array.isArray(existingIs)) return translatedEn;
    const out = existingIs.slice();
    for (let i = 0; i < translatedEn.length; i++) {
      const en = translatedEn[i];
      const is = out[i];
      if (typeof en === 'string') {
        if (typeof is !== 'string' || is.trim() === '') out[i] = en;
      } else if (en && typeof en === 'object') {
        out[i] = mergeTranslatedTree(en, is && typeof is === 'object' ? is : null);
      } else if (is === undefined) {
        out[i] = en;
      }
    }
    return out;
  }
  if (translatedEn && typeof translatedEn === 'object') {
    if (!existingIs || typeof existingIs !== 'object') return translatedEn;
    const out = { ...existingIs };
    for (const key of Object.keys(translatedEn)) {
      const en = translatedEn[key];
      const is = out[key];
      if (typeof en === 'string') {
        if (typeof is !== 'string' || is.trim() === '') out[key] = en;
      } else if (en && typeof en === 'object') {
        out[key] = mergeTranslatedTree(en, is && typeof is === 'object' ? is : null);
      } else if (is === undefined) {
        out[key] = en;
      }
    }
    return out;
  }
  return translatedEn;
}

// ── PUT /api/v1/content/:key ─────────────────────────────────────────────────
// Accepts an optional ?locale= query param to target a specific locale.
// When admin PUTs an English row AND auto-translate is on, also upsert a
// matching IS row with translated string leaves.
async function putContent(req, res, next) {
  try {
    const locale = req.query.locale || req.locale || DEFAULT_LOCALE;
    const userId = req.user?.id || null;

    // Consume and strip the auto-translate flag from the incoming body so it
    // never reaches the jsonb column (or the translator prompt).
    const wantsAutoTranslate = !Object.prototype.hasOwnProperty.call(req.body || {}, '__autoTranslate')
      || req.body.__autoTranslate !== false;
    if (req.body && typeof req.body === 'object') delete req.body.__autoTranslate;

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

    // Fire-and-forget-ish: run the translator side effect only when saving EN
    // content AND the feature flag / opt-in allow it. Failures are swallowed
    // so the EN save always succeeds.
    const otherLocale = 'is';
    if (
      wantsAutoTranslate
      && locale === DEFAULT_LOCALE
      && translatorEnabled()
      && !SITE_CONTENT_TRANSLATE_SKIP.has(req.params.key)
      && req.body && typeof req.body === 'object'
    ) {
      try {
        const translated = await translateTree(req.body);
        if (translated) {
          const { rows: existingIsRows } = await db.query(
            `SELECT value FROM site_content WHERE key = $1 AND locale = $2`,
            [req.params.key, otherLocale]
          );
          const existingIs = existingIsRows[0] ? existingIsRows[0].value : null;
          const merged = mergeTranslatedTree(translated, existingIs);
          await db.query(
            `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
             VALUES ($1, $2, $3::jsonb, $4, NOW())
             ON CONFLICT (key, locale) DO UPDATE
               SET value      = EXCLUDED.value,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = NOW()`,
            [req.params.key, otherLocale, JSON.stringify(merged), userId]
          );
        }
      } catch (sideErr) {
        // Never break the EN save because of a translator issue.
        logger.error({ err: sideErr, key: req.params.key }, 'contentController.putContent IS auto-fill failed');
      }
    }

    return res.json(rows[0].value);
  } catch (err) { return next(err); }
}

// ── POST /api/v1/content/:key/image ──────────────────────────────────────────
// Optional `?field=` selects which JSON key inside the row to populate
// (defaults to `image_url` for back-compat with `home_skills`). When the
// caller does NOT specify a locale, the URL is fanned out to every locale so
// admins don't have to re-upload the same visual per language.
const FIELD_RE = /^[A-Za-z_][\w]{0,63}$/;
const ALL_LOCALES = ['en', 'is'];

function uploadImage(req, res, next) {
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: t(req.locale, 'errors.content.noFileUploaded') });

    const imageUrl = `/assets/content/${req.file.filename}`;
    const merge    = req.query.merge !== 'false';
    const rawField = typeof req.query.field === 'string' ? req.query.field : '';
    const field    = FIELD_RE.test(rawField) ? rawField : 'image_url';
    const localeProvided = typeof req.query.locale === 'string' && req.query.locale.length > 0;
    const targets  = localeProvided
      ? [req.query.locale]
      : ALL_LOCALES;

    if (!merge) return res.json({ image_url: imageUrl, field });

    try {
      for (const locale of targets) {
        await db.query(
          `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
           VALUES ($1, $2, jsonb_build_object($5::text, $3::text), $4, NOW())
           ON CONFLICT (key, locale) DO UPDATE
             SET value      = site_content.value || jsonb_build_object($5::text, $3::text),
                 updated_by = EXCLUDED.updated_by,
                 updated_at = NOW()`,
          [req.params.key, locale, imageUrl, req.user?.id || null, field]
        );
      }
      return res.json({ image_url: imageUrl, field });
    } catch (dbErr) { return next(dbErr); }
  });
}

module.exports = { getContent, putContent, uploadImage };
