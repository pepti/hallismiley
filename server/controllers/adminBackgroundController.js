'use strict';
// Admin controller for the home-hero background config + the flat background
// media library. The active choice lives in site_content (locale 'en', read
// publicly via GET /api/v1/content/landing_background):
//   landing_background → { mode, photo_url, veil_percent }
//   mode: 'video' (the current default hero) | 'photo' (a library image) | 'plain'
// The media itself lives in background_media (BackgroundLibrary).
const path = require('path');
const fs   = require('fs');
const db   = require('../config/database');
const Lib  = require('../models/BackgroundLibrary');
const { backgroundUploadDir } = require('../config/paths');
const { mediaTypeForMime } = require('../middleware/upload');

const CONFIG_LOCALE   = 'en';
const LANDING_KEY     = 'landing_background';
const VALID_MODES     = ['video', 'photo', 'plain'];
const DEFAULT_LANDING = { mode: 'video', photo_url: null, veil_percent: 100 };

async function readConfig(key, fallback) {
  const { rows } = await db.query(
    'SELECT value FROM site_content WHERE key = $1 AND locale = $2', [key, CONFIG_LOCALE]
  );
  return rows[0] ? rows[0].value : fallback;
}

async function writeConfig(key, value, userId) {
  await db.query(
    `INSERT INTO site_content (key, locale, value, updated_by, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW())
     ON CONFLICT (key, locale) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [key, CONFIG_LOCALE, JSON.stringify(value), userId || null]
  );
  return value;
}

function bad(res, msg) { return res.status(400).json({ error: msg, code: 400 }); }

function diskPathForUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/assets/backgrounds/')) return null;
  return path.join(backgroundUploadDir(), path.basename(url));
}
function tryUnlink(url) {
  const p = diskPathForUrl(url);
  if (p) fs.promises.unlink(p).catch(() => { /* already gone — fine */ });
}

const ctrl = {
  // GET /api/v1/admin/background/landing
  async getLanding(req, res, next) {
    try { return res.json(await readConfig(LANDING_KEY, DEFAULT_LANDING)); }
    catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/background/landing { mode, photo_url, veil_percent }
  async updateLanding(req, res, next) {
    try {
      const body = req.body || {};
      if (!VALID_MODES.includes(body.mode)) return bad(res, `mode must be one of ${VALID_MODES.join(', ')}`);
      const veil = Number(body.veil_percent);
      if (!Number.isInteger(veil) || veil < 0 || veil > 100) {
        return bad(res, 'veil_percent must be an integer between 0 and 100');
      }
      let photo_url = null;
      if (body.mode === 'photo') {
        photo_url = body.photo_url;
        if (typeof photo_url !== 'string' || !photo_url) return bad(res, 'photo_url is required when mode is photo');
        const { rows } = await db.query(
          `SELECT 1 FROM background_media WHERE file_path = $1 AND media_type = 'image'`, [photo_url]
        );
        if (!rows[0]) return bad(res, 'photo_url must be an image in the background library');
      }
      const value = { mode: body.mode, photo_url, veil_percent: veil };
      await writeConfig(LANDING_KEY, value, req.user?.id);
      return res.json(value);
    } catch (err) { next(err); }
  },

  // GET /api/v1/admin/background/media
  async listMedia(req, res, next) {
    try { return res.json(await Lib.listMedia()); } catch (err) { next(err); }
  },

  // POST /api/v1/admin/background/media (multipart 'file')
  async uploadMedia(req, res, next) {
    try {
      if (!req.file) return bad(res, 'No file uploaded');
      const media = await Lib.addMedia({
        file_path:  `/assets/backgrounds/${req.file.filename}`,
        media_type: mediaTypeForMime(req.file.mimetype),
      });
      return res.status(201).json(media);
    } catch (err) { next(err); }
  },

  // DELETE /api/v1/admin/background/media/:id — unlinks the file and, if the
  // deleted image was the active landing photo, resets the landing to video.
  async deleteMedia(req, res, next) {
    try {
      const deleted = await Lib.deleteMedia(Number(req.params.id));
      if (!deleted) return res.status(404).json({ error: 'Media not found', code: 404 });
      const landing = await readConfig(LANDING_KEY, null);
      if (landing && landing.mode === 'photo' && landing.photo_url === deleted.file_path) {
        await writeConfig(LANDING_KEY, { ...DEFAULT_LANDING, veil_percent: landing.veil_percent }, req.user?.id);
      }
      tryUnlink(deleted.file_path);
      return res.status(204).send();
    } catch (err) { next(err); }
  },
};

module.exports = ctrl;
