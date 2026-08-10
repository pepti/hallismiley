'use strict';
// Admin controller for the home-hero background config + the background media
// library. Two pieces of config live in site_content (locale 'en', read
// publicly via GET /api/v1/content/:key):
//   landing_background → { mode, photo_url, veil_percent }
//     mode: 'video' (the current default hero) | 'photo' (a library image) | 'plain'
//   background_library → { enabled }
// The media and its sections live in background_media / background_sections
// (BackgroundLibrary, migrations 051 + 080).
const path = require('path');
const fs   = require('fs');
const db   = require('../config/database');
const logger = require('../logger');
const Lib  = require('../models/BackgroundLibrary');
const { backgroundUploadDir } = require('../config/paths');
const { mediaTypeForMime } = require('../middleware/upload');

const CONFIG_LOCALE   = 'en';
const LANDING_KEY     = 'landing_background';
const LIBRARY_KEY     = 'background_library';
const VALID_MODES     = ['video', 'photo', 'plain'];
const DEFAULT_LANDING = { mode: 'video', photo_url: null, veil_percent: 100 };
const DEFAULT_LIBRARY = { enabled: false };

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

  // ── Library enable toggle ──────────────────────────────────────────────────
  // GET /api/v1/admin/background/library
  async getLibrary(req, res, next) {
    try { return res.json(await readConfig(LIBRARY_KEY, DEFAULT_LIBRARY)); }
    catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/background/library { enabled }
  async updateLibrary(req, res, next) {
    try {
      const enabled = req.body?.enabled;
      if (typeof enabled !== 'boolean') return bad(res, 'enabled must be a boolean');
      const value = await writeConfig(LIBRARY_KEY, { enabled }, req.user?.id);
      return res.json(value);
    } catch (err) { next(err); }
  },

  // ── Sections ───────────────────────────────────────────────────────────────
  // GET /api/v1/admin/background/sections
  async listSections(req, res, next) {
    try { return res.json(await Lib.listSections()); } catch (err) { next(err); }
  },

  // POST /api/v1/admin/background/sections { name, name_is?, description?, description_is? }
  async createSection(req, res, next) {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) return bad(res, 'name is required');
      const section = await Lib.createSection({
        name,
        name_is:        req.body.name_is        != null ? String(req.body.name_is)        : null,
        description:    req.body.description    != null ? String(req.body.description)    : null,
        description_is: req.body.description_is != null ? String(req.body.description_is) : null,
      });
      return res.status(201).json(section);
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/background/sections/:id
  async updateSection(req, res, next) {
    try {
      const patch = {};
      for (const col of ['name', 'name_is', 'description', 'description_is']) {
        if (req.body[col] !== undefined) patch[col] = req.body[col] === null ? null : String(req.body[col]);
      }
      if (patch.name !== undefined) {
        patch.name = patch.name.trim();
        if (!patch.name) return bad(res, 'name cannot be empty');
      }
      const section = await Lib.updateSection(Number(req.params.id), patch);
      if (!section) return res.status(404).json({ error: 'Section not found', code: 404 });
      return res.json(section);
    } catch (err) { next(err); }
  },

  // DELETE /api/v1/admin/background/sections/:id — ungroups its media (FK is
  // ON DELETE SET NULL), it never deletes uploads.
  async deleteSection(req, res, next) {
    try {
      const ok = await Lib.deleteSection(Number(req.params.id));
      if (!ok) return res.status(404).json({ error: 'Section not found', code: 404 });
      return res.status(204).send();
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/background/sections/reorder { order: [{ id, sort_order }] }
  async reorderSections(req, res, next) {
    try {
      const order = req.body?.order;
      if (!Array.isArray(order)) return bad(res, 'order must be an array');
      return res.json(await Lib.reorderSections(order));
    } catch (err) {
      if (err.code === 'BAD_INPUT') return bad(res, err.message);
      next(err);
    }
  },

  // ── Media ──────────────────────────────────────────────────────────────────
  // GET /api/v1/admin/background/media
  async listMedia(req, res, next) {
    try { return res.json(await Lib.listMedia()); } catch (err) { next(err); }
  },

  // POST /api/v1/admin/background/media (multipart 'file', ?section_id=)
  async uploadMedia(req, res, next) {
    try {
      if (!req.file) return bad(res, 'No file uploaded');
      const sectionId = req.query.section_id ? Number(req.query.section_id) : null;
      const media = await Lib.addMedia({
        file_path:  `/assets/backgrounds/${req.file.filename}`,
        media_type: mediaTypeForMime(req.file.mimetype),
        section_id: Number.isFinite(sectionId) ? sectionId : null,
      });
      return res.status(201).json(media);
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/background/media/:id { caption?, caption_is?, section_id? }
  async updateMedia(req, res, next) {
    try {
      const patch = {};
      if (req.body.caption    !== undefined) patch.caption    = req.body.caption    === null ? null : String(req.body.caption);
      if (req.body.caption_is !== undefined) patch.caption_is = req.body.caption_is === null ? null : String(req.body.caption_is);
      if (req.body.section_id !== undefined) patch.section_id = req.body.section_id === null ? null : Number(req.body.section_id);
      const media = await Lib.updateMedia(Number(req.params.id), patch);
      if (!media) return res.status(404).json({ error: 'Media not found', code: 404 });
      return res.json(media);
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
        logger.info({ file: deleted.file_path }, '[background] deleted photo was the landing background — reset to video');
      }
      tryUnlink(deleted.file_path);
      return res.status(204).send();
    } catch (err) { next(err); }
  },

  // PATCH /api/v1/admin/background/media/reorder
  // { order: [{ id, sort_order, section_id? }] } — section_id may be null to ungroup.
  async reorderMedia(req, res, next) {
    try {
      const order = req.body?.order;
      if (!Array.isArray(order)) return bad(res, 'order must be an array');
      return res.json(await Lib.reorderMedia(order));
    } catch (err) {
      if (err.code === 'BAD_INPUT') return bad(res, err.message);
      next(err);
    }
  },
};

module.exports = ctrl;
