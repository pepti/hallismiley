const fs      = require('fs');
const path    = require('path');
const Project = require('../models/Project');
const { ProjectSection, ProjectVideo } = require('../models/Project');
const db      = require('../config/database');
const { MAX_IMAGE_SIZE } = require('../middleware/upload');
const { parseYouTubeId } = require('../utils/youtube');
const { UPLOAD_ROOT }    = require('../config/paths');
const { t }              = require('../i18n');
const { autoTranslateFields } = require('../services/autoTranslateFields');

// Field pairs for EN → IS auto-translation on admin save.
const PROJECT_TRANSLATE_PAIRS = [
  ['title',       'title_is',       'plain'],
  ['description', 'description_is', 'markdown'],
];
const SECTION_TRANSLATE_PAIRS = [
  ['name',        'name_is',        'plain'],
  ['description', 'description_is', 'markdown'],
];
const MEDIA_CAPTION_TRANSLATE_PAIRS  = [['caption', 'caption_is', 'plain']];
const VIDEO_TITLE_TRANSLATE_PAIRS    = [['title',   'title_is',   'plain']];

// URLs look like `/assets/projects/5/img.jpg` but the bytes live at
// `UPLOAD_ROOT/projects/5/img.jpg` — strip the `/assets` prefix when resolving.
function _diskPath(filePath) {
  return path.join(UPLOAD_ROOT, filePath.replace(/^\/assets\//, ''));
}

// Safely delete a file from disk (does not throw on missing file)
function _tryUnlink(filePath) {
  if (!filePath || !filePath.startsWith('/assets/projects/')) return;
  try { fs.unlinkSync(_diskPath(filePath)); } catch { /* ignore */ }
}

// Admin-facing column list — surfaces caption + caption_is so the CMS can
// render both languages side-by-side.
const MEDIA_COLUMNS = 'id, project_id, file_path, media_type, sort_order, caption, caption_is, section_id, created_at';

// Public-facing: COALESCE the IS caption when req.locale === 'is' so gallery
// thumbnails read in the viewer's language without the frontend needing to
// know about the _is column.
function mediaPublicCols(locale) {
  if (locale === 'is') {
    return `id, project_id, file_path, media_type, sort_order,
            COALESCE(caption_is, caption) AS caption,
            section_id, created_at`;
  }
  return 'id, project_id, file_path, media_type, sort_order, caption, section_id, created_at';
}

// Parse an incoming section_id value (body/form) into a valid integer or null.
// Returns { ok, value, errorKey } — `ok: false` means the caller should 400
// and pass `errorKey` through t(req.locale, ...).
function _parseSectionId(raw) {
  if (raw === undefined) return { ok: true, value: undefined }; // omit → don't touch
  if (raw === null || raw === '' || raw === 'null') return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, errorKey: 'errors.project.sectionIdPositiveOrNull' };
  }
  return { ok: true, value: n };
}

const projectController = {
  async getAll(req, res, next) {
    try {
      const { category, featured, year, limit, offset } = req.query;
      res.json(await Project.findAll({ category, featured, year, limit, offset, locale: req.locale }));
    } catch (err) { next(err); }
  },

  async getFeatured(req, res, next) {
    try {
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
      res.json(await Project.findFeatured(req.locale));
    } catch (err) { next(err); }
  },

  async getOne(req, res, next) {
    try {
      const project = await Project.findById(req.params.id, { locale: req.locale });
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });
      res.json(project);
    } catch (err) { next(err); }
  },

  async create(req, res, next) {
    try {
      // Auto-fill empty IS fields from their EN counterparts before create.
      await autoTranslateFields(req.body, PROJECT_TRANSLATE_PAIRS);
      res.status(201).json(await Project.create(req.body));
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      // Fetch the current row so autoTranslateFields can skip overwriting
      // IS content that is already stored when the payload only edits EN.
      const existingRow = await Project.findById(req.params.id);
      await autoTranslateFields(req.body, PROJECT_TRANSLATE_PAIRS, { existingRow });
      const project = await Project.update(req.params.id, req.body);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });
      res.json(project);
    } catch (err) { next(err); }
  },

  async remove(req, res, next) {
    try {
      const deleted = await Project.delete(req.params.id);
      if (!deleted) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async getMedia(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      // NULLS FIRST so the "Ungrouped" bucket naturally precedes named sections
      // in the flat array — frontend groups these client-side by section_id.
      const cols = mediaPublicCols(req.locale);
      const { rows } = await db.query(
        `SELECT ${cols}
         FROM project_media
         WHERE project_id = $1
         ORDER BY section_id ASC NULLS FIRST, sort_order ASC, id ASC`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  // ── Media management ───────────────────────────────────────────────────────

  async addMedia(req, res, next) {
    try {
      const projectId = Number(req.params.id);
      const project   = await Project.findById(projectId);
      if (!project) {
        if (req.file) _tryUnlink(`/assets/projects/${projectId}/${req.file.filename}`);
        return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });
      }

      let filePath, mediaType, caption, sortOrder;

      // Auto-fill caption_is from caption before we pluck fields out of body.
      await autoTranslateFields(req.body, MEDIA_CAPTION_TRANSLATE_PAIRS);
      const captionIs = typeof req.body.caption_is === 'string' && req.body.caption_is.trim() !== ''
        ? req.body.caption_is
        : null;

      if (req.file) {
        // Multipart file upload
        mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';

        // Enforce per-type size limit (multer allows up to MAX_VIDEO_SIZE globally)
        if (mediaType === 'image' && req.file.size > MAX_IMAGE_SIZE) {
          _tryUnlink(`/assets/projects/${projectId}/${req.file.filename}`);
          return res.status(400).json({ error: t(req.locale, 'errors.project.imageTooLarge'), code: 400 });
        }

        filePath  = `/assets/projects/${projectId}/${req.file.filename}`;
        caption   = req.body.caption   || null;
        sortOrder = req.body.sort_order ? parseInt(req.body.sort_order, 10) : 0;
      } else {
        // JSON body with existing file_path
        const { file_path, media_type, caption: cap, sort_order } = req.body;

        if (!file_path || typeof file_path !== 'string') {
          return res.status(400).json({ error: t(req.locale, 'errors.project.filePathRequired'), code: 400 });
        }
        if (!['image', 'video'].includes(media_type)) {
          return res.status(400).json({ error: t(req.locale, 'errors.project.mediaType'), code: 400 });
        }

        filePath  = file_path;
        mediaType = media_type;
        caption   = cap  || null;
        sortOrder = sort_order !== undefined ? parseInt(sort_order, 10) : 0;
      }

      // Optional section assignment (null = Ungrouped). Accept from both multipart body and JSON.
      const parsedSection = _parseSectionId(req.body.section_id);
      if (!parsedSection.ok) {
        if (req.file) _tryUnlink(`/assets/projects/${projectId}/${req.file.filename}`);
        return res.status(400).json({ error: t(req.locale, parsedSection.errorKey), code: 400 });
      }
      const sectionId = parsedSection.value ?? null;

      // If a section was specified, verify it belongs to this project
      if (sectionId !== null) {
        const { rows: secRows } = await db.query(
          `SELECT id FROM project_sections WHERE id = $1 AND project_id = $2`,
          [sectionId, projectId]
        );
        if (!secRows[0]) {
          if (req.file) _tryUnlink(`/assets/projects/${projectId}/${req.file.filename}`);
          return res.status(400).json({ error: t(req.locale, 'errors.project.sectionNotInProject'), code: 400 });
        }
      }

      const { rows } = await db.query(
        `INSERT INTO project_media (project_id, file_path, media_type, sort_order, caption, caption_is, section_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${MEDIA_COLUMNS}`,
        [projectId, filePath, mediaType, sortOrder, caption, captionIs, sectionId]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (req.file) {
        _tryUnlink(`/assets/projects/${req.params.id}/${req.file.filename}`);
      }
      next(err);
    }
  },

  async updateMedia(req, res, next) {
    try {
      const projectId = Number(req.params.id);
      const mediaId   = Number(req.params.mediaId);

      // Verify project exists
      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      // Existing row context so auto-translate can skip filled IS captions.
      const { rows: currentRows } = await db.query(
        `SELECT id, caption, caption_is FROM project_media WHERE id = $1 AND project_id = $2`,
        [mediaId, projectId]
      );
      const existingRow = currentRows[0] || null;
      await autoTranslateFields(req.body, MEDIA_CAPTION_TRANSLATE_PAIRS, { existingRow });

      // Only update fields that are allowed
      const { caption, caption_is, sort_order } = req.body;
      const sets   = [];
      const params = [];

      if (caption !== undefined) {
        params.push(caption);
        sets.push(`caption = $${params.length}`);
      }
      if (caption_is !== undefined) {
        // Empty string → null so admin can clear the translation.
        const v = typeof caption_is === 'string' && caption_is.trim() === '' ? null : caption_is;
        params.push(v);
        sets.push(`caption_is = $${params.length}`);
      }
      if (sort_order !== undefined) {
        params.push(parseInt(sort_order, 10));
        sets.push(`sort_order = $${params.length}`);
      }

      // Section assignment — null means "move back to Ungrouped"
      if (req.body.section_id !== undefined) {
        const parsed = _parseSectionId(req.body.section_id);
        if (!parsed.ok) return res.status(400).json({ error: t(req.locale, parsed.errorKey), code: 400 });
        if (parsed.value !== null) {
          const { rows: secRows } = await db.query(
            `SELECT id FROM project_sections WHERE id = $1 AND project_id = $2`,
            [parsed.value, projectId]
          );
          if (!secRows[0]) {
            return res.status(400).json({ error: t(req.locale, 'errors.project.sectionNotInProject'), code: 400 });
          }
        }
        params.push(parsed.value);
        sets.push(`section_id = $${params.length}`);
      }

      if (sets.length === 0) {
        // Nothing to update — return current state
        const { rows } = await db.query(
          `SELECT ${MEDIA_COLUMNS} FROM project_media WHERE id = $1 AND project_id = $2`,
          [mediaId, projectId]
        );
        if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.project.mediaNotFound'), code: 404 });
        return res.json(rows[0]);
      }

      params.push(mediaId);
      params.push(projectId);
      const { rows } = await db.query(
        `UPDATE project_media
         SET ${sets.join(', ')}
         WHERE id = $${params.length - 1} AND project_id = $${params.length}
         RETURNING ${MEDIA_COLUMNS}`,
        params
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.project.mediaNotFound'), code: 404 });
      res.json(rows[0]);
    } catch (err) { next(err); }
  },

  async deleteMedia(req, res, next) {
    try {
      const projectId = Number(req.params.id);
      const mediaId   = Number(req.params.mediaId);

      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      const { rows } = await db.query(
        `DELETE FROM project_media
         WHERE id = $1 AND project_id = $2
         RETURNING file_path`,
        [mediaId, projectId]
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.project.mediaNotFound'), code: 404 });

      // Remove file from disk if it is a locally-stored asset
      _tryUnlink(rows[0].file_path);

      res.status(204).send();
    } catch (err) { next(err); }
  },

  async reorderMedia(req, res, next) {
    try {
      const projectId = Number(req.params.id);

      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      const { order } = req.body; // [{ id, sort_order, section_id? }, ...]

      // Verify all supplied IDs belong to this project
      const ids = order.map(item => item.id);
      const { rows: existing } = await db.query(
        `SELECT id FROM project_media WHERE project_id = $1 AND id = ANY($2::int[])`,
        [projectId, ids]
      );
      if (existing.length !== ids.length) {
        return res.status(400).json({
          error: t(req.locale, 'errors.project.mediaBelongsToProject'),
          code: 400,
        });
      }

      // Validate any supplied section_ids belong to this project. Collect the
      // distinct non-null ones and check in a single query for efficiency.
      const sectionIds = [...new Set(
        order
          .filter(item => item.section_id !== undefined && item.section_id !== null)
          .map(item => Number(item.section_id))
      )];
      if (sectionIds.length) {
        const { rows: secs } = await db.query(
          `SELECT id FROM project_sections WHERE project_id = $1 AND id = ANY($2::int[])`,
          [projectId, sectionIds]
        );
        if (secs.length !== sectionIds.length) {
          return res.status(400).json({
            error: t(req.locale, 'errors.project.sectionBelongsToProject'),
            code: 400,
          });
        }
      }

      // Batch update inside a transaction. If section_id is supplied on an
      // item, update both columns; otherwise keep the existing section.
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (const item of order) {
          if (item.section_id !== undefined) {
            const sid = item.section_id === null ? null : Number(item.section_id);
            await client.query(
              'UPDATE project_media SET sort_order = $1, section_id = $2 WHERE id = $3 AND project_id = $4',
              [item.sort_order, sid, item.id, projectId]
            );
          } else {
            await client.query(
              'UPDATE project_media SET sort_order = $1 WHERE id = $2 AND project_id = $3',
              [item.sort_order, item.id, projectId]
            );
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const { rows } = await db.query(
        `SELECT ${MEDIA_COLUMNS}
         FROM project_media
         WHERE project_id = $1
         ORDER BY section_id ASC NULLS FIRST, sort_order ASC, id ASC`,
        [projectId]
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  // ── Section CRUD ───────────────────────────────────────────────────────────

  async getSections(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });
      res.json(await ProjectSection.list(req.params.id, { locale: req.locale }));
    } catch (err) { next(err); }
  },

  async createSection(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      // Auto-fill IS fields from EN before insert.
      await autoTranslateFields(req.body, SECTION_TRANSLATE_PAIRS);

      const name        = req.body.name.trim();
      const description = req.body.description != null ? String(req.body.description) : null;
      const name_is        = req.body.name_is        != null ? String(req.body.name_is)        : null;
      const description_is = req.body.description_is != null ? String(req.body.description_is) : null;
      const section = await ProjectSection.create(req.params.id, name, description, { name_is, description_is });
      res.status(201).json(section);
    } catch (err) { next(err); }
  },

  async updateSection(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      // Look up current section to protect existing IS content on EN-only PATCH.
      const { rows: currentRows } = await db.query(
        `SELECT id, name, description, name_is, description_is
           FROM project_sections
          WHERE id = $1 AND project_id = $2`,
        [Number(req.params.sectionId), Number(req.params.id)]
      );
      const existingRow = currentRows[0] || null;

      await autoTranslateFields(req.body, SECTION_TRANSLATE_PAIRS, { existingRow });

      const patch = {};
      if (req.body.name !== undefined)           patch.name           = req.body.name.trim();
      if (req.body.description !== undefined)    patch.description    = req.body.description;
      if (req.body.name_is !== undefined)        patch.name_is        = req.body.name_is;
      if (req.body.description_is !== undefined) patch.description_is = req.body.description_is;

      const section = await ProjectSection.update(req.params.id, req.params.sectionId, patch);
      if (!section) return res.status(404).json({ error: t(req.locale, 'errors.project.sectionNotFound'), code: 404 });
      res.json(section);
    } catch (err) { next(err); }
  },

  async reorderSections(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      const { order } = req.body;
      const ids = order.map(i => Number(i.id));
      const { rows: existing } = await db.query(
        `SELECT id FROM project_sections WHERE project_id = $1 AND id = ANY($2::int[])`,
        [req.params.id, ids]
      );
      if (existing.length !== ids.length) {
        return res.status(400).json({
          error: t(req.locale, 'errors.project.sectionBelongsToProject'),
          code: 400,
        });
      }

      const sections = await ProjectSection.reorder(req.params.id, order);
      res.json(sections);
    } catch (err) { next(err); }
  },

  async deleteSection(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      const deleted = await ProjectSection.delete(req.params.id, req.params.sectionId);
      if (!deleted) return res.status(404).json({ error: t(req.locale, 'errors.project.sectionNotFound'), code: 404 });
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // ── Video section ──────────────────────────────────────────────────────────

  async getVideos(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });
      res.json(await ProjectVideo.list(req.params.id, { locale: req.locale }));
    } catch (err) { next(err); }
  },

  async addVideo(req, res, next) {
    try {
      const projectId = Number(req.params.id);
      const project   = await Project.findById(projectId);
      if (!project) {
        if (req.file) _tryUnlink(`/assets/projects/${projectId}/${req.file.filename}`);
        return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });
      }

      // Auto-translate title → title_is on add.
      await autoTranslateFields(req.body, VIDEO_TITLE_TRANSLATE_PAIRS);

      const title    = typeof req.body.title    === 'string' ? req.body.title    : null;
      const title_is = typeof req.body.title_is === 'string' ? req.body.title_is : null;

      // Two intake paths: multipart upload OR JSON body with a YouTube URL
      if (req.file) {
        // File upload — reuse multer storage path convention
        const mediaType = req.file.mimetype.startsWith('video/') ? 'video' : null;
        if (!mediaType) {
          _tryUnlink(`/assets/projects/${projectId}/${req.file.filename}`);
          return res.status(400).json({ error: t(req.locale, 'errors.project.onlyVideoFiles'), code: 400 });
        }

        const filePath = `/assets/projects/${projectId}/${req.file.filename}`;
        const row = await ProjectVideo.create(projectId, {
          kind:      'file',
          file_path: filePath,
          title,
          title_is,
        });
        return res.status(201).json(row);
      }

      // JSON body: { url } for a YouTube embed
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: t(req.locale, 'errors.project.videoOrYoutubeRequired'), code: 400 });
      }
      const youtubeId = parseYouTubeId(url);
      if (!youtubeId) {
        return res.status(400).json({ error: t(req.locale, 'errors.news.invalidYoutubeUrl'), code: 400 });
      }

      const row = await ProjectVideo.create(projectId, {
        kind:       'youtube',
        youtube_id: youtubeId,
        title,
        title_is,
      });
      return res.status(201).json(row);
    } catch (err) {
      if (req.file) {
        _tryUnlink(`/assets/projects/${req.params.id}/${req.file.filename}`);
      }
      next(err);
    }
  },

  async updateVideo(req, res, next) {
    try {
      const projectId = Number(req.params.id);
      const project   = await Project.findById(projectId);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      // Read the existing row so auto-translate can honour manually-typed IS titles.
      const { rows: currentRows } = await db.query(
        `SELECT id, title, title_is FROM project_videos WHERE id = $1 AND project_id = $2`,
        [Number(req.params.videoId), projectId]
      );
      const existingRow = currentRows[0] || null;
      await autoTranslateFields(req.body, VIDEO_TITLE_TRANSLATE_PAIRS, { existingRow });

      const row = await ProjectVideo.update(projectId, req.params.videoId, {
        title:    req.body.title,
        title_is: req.body.title_is,
      });
      if (!row) return res.status(404).json({ error: t(req.locale, 'errors.project.videoNotFound'), code: 404 });
      res.json(row);
    } catch (err) { next(err); }
  },

  async reorderVideos(req, res, next) {
    try {
      const projectId = Number(req.params.id);
      const project   = await Project.findById(projectId);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      const { order } = req.body;
      const ids = order.map(i => Number(i.id));
      const { rows: existing } = await db.query(
        `SELECT id FROM project_videos WHERE project_id = $1 AND id = ANY($2::int[])`,
        [projectId, ids]
      );
      if (existing.length !== ids.length) {
        return res.status(400).json({
          error: t(req.locale, 'errors.project.videoBelongsToProject'),
          code: 400,
        });
      }

      const rows = await ProjectVideo.reorder(projectId, order);
      res.json(rows);
    } catch (err) { next(err); }
  },

  async deleteVideo(req, res, next) {
    try {
      const projectId = Number(req.params.id);
      const project   = await Project.findById(projectId);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      const deleted = await ProjectVideo.delete(projectId, req.params.videoId);
      if (!deleted) return res.status(404).json({ error: t(req.locale, 'errors.project.videoNotFound'), code: 404 });

      if (deleted.kind === 'file' && deleted.file_path) _tryUnlink(deleted.file_path);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async deleteVideoSection(req, res, next) {
    // Clears every video from the project — used by the edit-mode
    // "Delete Video Section" button.
    try {
      const projectId = Number(req.params.id);
      const project   = await Project.findById(projectId);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      const removed = await ProjectVideo.deleteAll(projectId);
      for (const r of removed) {
        if (r.kind === 'file' && r.file_path) _tryUnlink(r.file_path);
      }
      res.status(204).send();
    } catch (err) { next(err); }
  },

  async setVideoSectionPosition(req, res, next) {
    try {
      const projectId = Number(req.params.id);
      const { position } = req.body;
      if (!['above_gallery', 'below_gallery'].includes(position)) {
        return res.status(400).json({
          error: t(req.locale, 'errors.project.invalidPosition'),
          code: 400,
        });
      }
      const updated = await Project.update(projectId, { video_section_position: position });
      if (!updated) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });
      res.json(updated);
    } catch (err) { next(err); }
  },

  async setCover(req, res, next) {
    try {
      const projectId = Number(req.params.id);

      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ error: t(req.locale, 'errors.project.projectNotFound'), code: 404 });

      const { media_id } = req.body;
      if (!media_id || !Number.isInteger(Number(media_id))) {
        return res.status(400).json({ error: t(req.locale, 'errors.project.mediaIdRequired'), code: 400 });
      }

      const { rows: mediaRows } = await db.query(
        `SELECT file_path FROM project_media WHERE id = $1 AND project_id = $2`,
        [Number(media_id), projectId]
      );
      if (!mediaRows[0]) {
        return res.status(404).json({ error: t(req.locale, 'errors.project.mediaNotFound'), code: 404 });
      }

      const updated = await Project.update(projectId, { image_url: mediaRows[0].file_path });
      res.json(updated);
    } catch (err) { next(err); }
  },
};

module.exports = projectController;
