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

// Shallow-merge EN translations into an existing IS tree.
//
// A string leaf in the IS tree gets overwritten by its translated EN
// counterpart in any of these cases:
//
//   1. The IS leaf is null / undefined / empty — nothing to preserve.
//   2. The IS leaf is byte-identical to the corresponding ORIGINAL EN leaf
//      (sourceEn) — fingerprint of "stale-EN-as-IS" content (a row that
//      was seeded by copying EN to IS, or an inline-editor flow that
//      wrote EN text into the IS field). Replace with the proper
//      Icelandic translation.
//   3. The corresponding leaf in the PREVIOUS EN row (previousEn) was a
//      string AND it differs from the new sourceEn[k] — i.e. the admin
//      just edited that EN leaf. The user's stated intent is "EN is the
//      source of truth, IS auto-tracks", so changes to EN should always
//      flow through to IS, even when the IS leaf currently holds a stale
//      translation of the previous EN value (e.g. EN was "The Beginning"
//      → IS got "Upphafið"; EN now "Years of experience" → IS still
//      shows "Upphafið" without this rule).
//
// Anything else — IS differs from sourceEn AND EN didn't change — is
// treated as a genuine manual IS edit and left alone.
//
// Keys in the translator's BLOCK_KEYS list never appear in `translatedEn`
// because `translateTree` filters them out.
//
// Falls back to the translated EN tree when no IS row exists yet.
function mergeTranslatedTree(translatedEn, existingIs, sourceEn, previousEn) {
  if (existingIs === null || existingIs === undefined) return translatedEn;
  if (Array.isArray(translatedEn)) {
    if (!Array.isArray(existingIs)) return translatedEn;
    const srcArr = Array.isArray(sourceEn) ? sourceEn : null;
    const prevArr = Array.isArray(previousEn) ? previousEn : null;
    const out = existingIs.slice();
    for (let i = 0; i < translatedEn.length; i++) {
      const en = translatedEn[i];
      const is = out[i];
      const src = srcArr ? srcArr[i] : undefined;
      const prev = prevArr ? prevArr[i] : undefined;
      if (typeof en === 'string') {
        const isEmpty       = typeof is !== 'string' || is.trim() === '';
        const isStaleEnCopy = typeof is === 'string' && typeof src === 'string' && is === src;
        const enChanged     = typeof prev === 'string' && typeof src === 'string' && prev !== src;
        if (isEmpty || isStaleEnCopy || enChanged) out[i] = en;
      } else if (en && typeof en === 'object') {
        out[i] = mergeTranslatedTree(
          en,
          is && typeof is === 'object' ? is : null,
          src && typeof src === 'object' ? src : null,
          prev && typeof prev === 'object' ? prev : null,
        );
      } else if (is === undefined) {
        out[i] = en;
      }
    }
    return out;
  }
  if (translatedEn && typeof translatedEn === 'object') {
    if (!existingIs || typeof existingIs !== 'object') return translatedEn;
    const srcObj  = sourceEn   && typeof sourceEn   === 'object' && !Array.isArray(sourceEn)   ? sourceEn   : null;
    const prevObj = previousEn && typeof previousEn === 'object' && !Array.isArray(previousEn) ? previousEn : null;
    const out = { ...existingIs };
    for (const key of Object.keys(translatedEn)) {
      const en = translatedEn[key];
      const is = out[key];
      const src  = srcObj  ? srcObj[key]  : undefined;
      const prev = prevObj ? prevObj[key] : undefined;
      if (typeof en === 'string') {
        const isEmpty       = typeof is !== 'string' || is.trim() === '';
        const isStaleEnCopy = typeof is === 'string' && typeof src === 'string' && is === src;
        const enChanged     = typeof prev === 'string' && typeof src === 'string' && prev !== src;
        if (isEmpty || isStaleEnCopy || enChanged) out[key] = en;
      } else if (en && typeof en === 'object') {
        out[key] = mergeTranslatedTree(
          en,
          is && typeof is === 'object' ? is : null,
          src && typeof src === 'object' ? src : null,
          prev && typeof prev === 'object' ? prev : null,
        );
      } else if (is === undefined) {
        out[key] = en;
      }
    }
    return out;
  }
  return translatedEn;
}

// ── Auto-translate side effect ───────────────────────────────────────────────
// Translates `sourceEn` (the just-saved EN body) and merges into the IS row.
// Run in the background — never awaited from the request handler — so the
// browser does not sit on "Saving…" while the LLM works through dozens of
// nested string leaves on big jsonb keys like halli_bio.
//
// `previousEn` is the EN row's value BEFORE the just-completed upsert
// (or null if the EN row didn't exist yet). Passing it lets the merge
// detect "EN leaf changed since last save" and overwrite the stale
// IS translation that no longer matches the new EN.
async function runAutoTranslateSideEffect(key, sourceEn, previousEn, userId) {
  const translated = await translateTree(sourceEn);
  if (!translated) return;
  const { rows } = await db.query(
    `SELECT value FROM site_content WHERE key = $1 AND locale = $2`,
    [key, 'is']
  );
  const existingIs = rows[0] ? rows[0].value : null;
  const merged = mergeTranslatedTree(translated, existingIs, sourceEn, previousEn);
  await db.query(
    `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
     VALUES ($1, 'is', $2::jsonb, $3, NOW())
     ON CONFLICT (key, locale) DO UPDATE
       SET value      = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [key, JSON.stringify(merged), userId]
  );
}

// ── PUT /api/v1/content/:key ─────────────────────────────────────────────────
// Accepts an optional ?locale= query param to target a specific locale.
// When admin PUTs an English row AND auto-translate is on, also upsert a
// matching IS row with translated string leaves — but the EN response
// returns immediately; the IS write happens in the background. The browser
// stays responsive even when translateTree walks 100+ string leaves.
async function putContent(req, res, next) {
  try {
    const locale = req.query.locale || req.locale || DEFAULT_LOCALE;
    const userId = req.user?.id || null;
    const key = req.params.key;

    // Consume and strip the auto-translate flag from the incoming body so it
    // never reaches the jsonb column (or the translator prompt).
    const wantsAutoTranslate = !Object.prototype.hasOwnProperty.call(req.body || {}, '__autoTranslate')
      || req.body.__autoTranslate !== false;
    if (req.body && typeof req.body === 'object') delete req.body.__autoTranslate;

    // The upsert below cannot return the OLD row's value (postgres only
    // exposes EXCLUDED + the merged result). Capture the prior EN value
    // via a separate SELECT first. The auto-translate merge uses this
    // to detect which leaves changed since the last save and need their
    // IS counterpart retranslated. Skipped when saving an IS row
    // directly — we never need previousEn for a non-EN write path.
    let previousEn = null;
    if (locale === DEFAULT_LOCALE) {
      const prev = await db.query(
        `SELECT value FROM site_content WHERE key = $1 AND locale = $2`,
        [key, DEFAULT_LOCALE]
      );
      previousEn = prev.rows[0] ? prev.rows[0].value : null;
    }

    const { rows } = await db.query(
      `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (key, locale) DO UPDATE
         SET value      = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING value`,
      [key, locale, JSON.stringify(req.body), userId]
    );

    // Send the EN response immediately. The background translation below
    // continues in the same Node process; it does not affect the response.
    res.json(rows[0].value);

    // Run the translator side effect only when saving EN content AND the
    // feature flag / opt-in allow it. Captures the body locally because
    // req can become unsafe to read after the response is sent.
    const shouldTranslate =
      wantsAutoTranslate
      && locale === DEFAULT_LOCALE
      && translatorEnabled()
      && !SITE_CONTENT_TRANSLATE_SKIP.has(key)
      && req.body && typeof req.body === 'object';

    if (shouldTranslate) {
      const sourceEn = req.body;
      runAutoTranslateSideEffect(key, sourceEn, previousEn, userId)
        .catch(err => logger.error(
          { err, key },
          'contentController.putContent IS auto-fill failed (background)'
        ));
    }
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

    // Locale fan-out runs inside a single transaction so EN/IS rows never
    // diverge if a query fails partway. Using a checked-out client (rather
    // than db.query) keeps every statement on the same connection.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const locale of targets) {
        await client.query(
          `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
           VALUES ($1, $2, jsonb_build_object($5::text, $3::text), $4, NOW())
           ON CONFLICT (key, locale) DO UPDATE
             SET value      = site_content.value || jsonb_build_object($5::text, $3::text),
                 updated_by = EXCLUDED.updated_by,
                 updated_at = NOW()`,
          [req.params.key, locale, imageUrl, req.user?.id || null, field]
        );
      }
      await client.query('COMMIT');
      return res.json({ image_url: imageUrl, field });
    } catch (dbErr) {
      await client.query('ROLLBACK').catch(() => {});
      return next(dbErr);
    } finally {
      client.release();
    }
  });
}

module.exports = { getContent, putContent, uploadImage };
