const fs   = require('fs');
const path = require('path');
const db   = require('../config/database');
const { MAX_IMAGE_SIZE } = require('../middleware/upload');
const { parseYouTubeId } = require('../utils/youtube');
const { UPLOAD_ROOT } = require('../config/paths');

const MEDIA_COLS = 'id, article_id, kind, file_path, youtube_id, caption, sort_order, created_at';

// URLs look like `/assets/news/18/foo.mp4` but the bytes live at
// `UPLOAD_ROOT/news/18/foo.mp4` — strip the `/assets` prefix when resolving.
function _diskPath(filePath) {
  return path.join(UPLOAD_ROOT, filePath.replace(/^\/assets\//, ''));
}

function _tryUnlink(filePath) {
  if (!filePath || !filePath.startsWith('/assets/news/')) return;
  try { fs.unlinkSync(_diskPath(filePath)); } catch { /* ignore */ }
}

// Column list shared between queries — keeps SELECT consistent
const ARTICLE_COLS = `
  a.id, a.title, a.slug, a.summary, a.body, a.cover_image,
  a.category, a.author_id, a.published, a.published_at,
  a.created_at, a.updated_at,
  u.username AS author_username,
  u.display_name AS author_display_name,
  u.avatar AS author_avatar
`;

// Auto-generate a slug from a title string
function _slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

// Ensure a slug is unique in the DB; append -2, -3, … if needed
async function _uniqueSlug(base, excludeId = null) {
  let candidate = base;
  let suffix    = 2;
  let found     = false;
  while (!found) {
    const { rows } = await db.query(
      `SELECT id FROM news_articles WHERE slug = $1${excludeId ? ' AND id <> $2' : ''}`,
      excludeId ? [candidate, excludeId] : [candidate]
    );
    if (rows.length === 0) {
      found = true;
    } else {
      candidate = `${base}-${suffix++}`;
    }
  }
  return candidate;
}

const newsController = {

  // ── GET /api/v1/news ────────────────────────────────────────────────────
  // Public — list published articles, newest first, with pagination.
  async list(req, res, next) {
    try {
      const limit  = Math.min(parseInt(req.query.limit  ?? '10', 10), 100);
      const offset = Math.min(parseInt(req.query.offset ?? '0',  10), 1_000_000);
      const category = req.query.category;

      if (!Number.isFinite(limit)  || limit  < 1) return res.status(400).json({ error: 'invalid limit',  code: 400 });
      if (!Number.isFinite(offset) || offset < 0) return res.status(400).json({ error: 'invalid offset', code: 400 });

      const params = [];
      let where = 'WHERE a.published = TRUE';

      if (category) {
        params.push(category);
        where += ` AND a.category = $${params.length}`;
      }

      params.push(limit, offset);

      const { rows } = await db.query(
        `SELECT ${ARTICLE_COLS}
         FROM   news_articles a
         LEFT JOIN users u ON u.id = a.author_id
         ${where}
         ORDER  BY a.published_at DESC, a.created_at DESC
         LIMIT  $${params.length - 1}
         OFFSET $${params.length}`,
        params
      );

      // Total count for pagination meta
      const countParams = category ? [category] : [];
      const countWhere  = category ? 'WHERE published = TRUE AND category = $1' : 'WHERE published = TRUE';
      const { rows: countRows } = await db.query(
        `SELECT COUNT(*)::int AS total FROM news_articles ${countWhere}`,
        countParams
      );

      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
      res.json({ articles: rows, total: countRows[0].total, limit, offset });
    } catch (err) { next(err); }
  },

  // ── GET /api/v1/news/:slug ──────────────────────────────────────────────
  // Public — fetch a single published article by slug.
  async getOne(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT ${ARTICLE_COLS}
         FROM   news_articles a
         LEFT JOIN users u ON u.id = a.author_id
         WHERE  a.slug = $1 AND a.published = TRUE`,
        [req.params.slug]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Article not found', code: 404 });
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
      res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // ── GET /api/v1/news/:slug/preview ─────────────────────────────────────
  // Admin/moderator — fetch any article (published or draft) by slug.
  async preview(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT ${ARTICLE_COLS}
         FROM   news_articles a
         LEFT JOIN users u ON u.id = a.author_id
         WHERE  a.slug = $1`,
        [req.params.slug]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Article not found', code: 404 });
      res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // ── POST /api/v1/news ───────────────────────────────────────────────────
  // Admin/moderator — create a new article.
  async create(req, res, next) {
    try {
      const {
        title, summary, body, cover_image = null,
        category = 'news', published = false,
      } = req.body;

      // Slug: use provided or auto-generate from title
      let rawSlug = req.body.slug
        ? String(req.body.slug).toLowerCase().replace(/[^\w-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
        : _slugify(title);
      const slug = await _uniqueSlug(rawSlug);

      const published_at = published ? (req.body.published_at || new Date().toISOString()) : null;

      const { rows } = await db.query(
        `INSERT INTO news_articles
           (title, slug, summary, body, cover_image, category, author_id, published, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [title, slug, summary, body, cover_image, category, req.user.id, published, published_at]
      );

      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'news_articles_slug_key') {
        return res.status(409).json({ error: 'An article with this slug already exists', code: 409 });
      }
      next(err);
    }
  },

  // ── PATCH /api/v1/news/:id ──────────────────────────────────────────────
  // Admin/moderator — update an article.
  async update(req, res, next) {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id', code: 400 });

      const { rows: existing } = await db.query(
        'SELECT * FROM news_articles WHERE id = $1', [id]
      );
      if (!existing[0]) return res.status(404).json({ error: 'Article not found', code: 404 });

      const current = existing[0];

      const title       = req.body.title       !== undefined ? req.body.title       : current.title;
      const summary     = req.body.summary     !== undefined ? req.body.summary     : current.summary;
      const body        = req.body.body        !== undefined ? req.body.body        : current.body;
      const cover_image = req.body.cover_image !== undefined ? req.body.cover_image : current.cover_image;
      const category    = req.body.category    !== undefined ? req.body.category    : current.category;
      const published   = req.body.published   !== undefined ? req.body.published   : current.published;

      // Slug handling: if provided update it (with uniqueness check), else keep existing
      let slug = current.slug;
      if (req.body.slug !== undefined) {
        const rawSlug = String(req.body.slug).toLowerCase().replace(/[^\w-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
        slug = await _uniqueSlug(rawSlug, id);
      }

      // published_at: set when publishing for the first time, keep if already set
      let published_at = current.published_at;
      if (published && !current.published_at) {
        published_at = req.body.published_at || new Date().toISOString();
      } else if (!published) {
        // Allow explicit null to un-publish timestamp
        if (req.body.published_at === null) published_at = null;
      }

      const { rows } = await db.query(
        `UPDATE news_articles
         SET title = $1, slug = $2, summary = $3, body = $4,
             cover_image = $5, category = $6, published = $7, published_at = $8
         WHERE id = $9
         RETURNING *`,
        [title, slug, summary, body, cover_image, category, published, published_at, id]
      );

      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'news_articles_slug_key') {
        return res.status(409).json({ error: 'An article with this slug already exists', code: 409 });
      }
      next(err);
    }
  },

  // ── DELETE /api/v1/news/:id ─────────────────────────────────────────────
  // Admin only — permanently delete an article.
  async remove(req, res, next) {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id', code: 400 });

      const { rows } = await db.query(
        'DELETE FROM news_articles WHERE id = $1 RETURNING id', [id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Article not found', code: 404 });
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // ── GET /api/v1/news/:id/media ──────────────────────────────────────────
  // Public — list media attached to an article (ordered by sort_order).
  async getMedia(req, res, next) {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id', code: 400 });
      const { rows } = await db.query(
        `SELECT ${MEDIA_COLS} FROM news_media WHERE article_id = $1 ORDER BY sort_order, id`,
        [id]
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  // ── POST /api/v1/news/:id/media ───────────────────────────────────────
  // Admin/moderator — upload an image or video file to an article.
  async addMedia(req, res, next) {
    try {
      const articleId = parseInt(req.params.id, 10);
      if (!Number.isInteger(articleId)) {
        if (req.file) _tryUnlink(`/assets/news/${req.params.id}/${req.file.filename}`);
        return res.status(400).json({ error: 'invalid id', code: 400 });
      }

      const { rows: article } = await db.query(
        'SELECT id FROM news_articles WHERE id = $1', [articleId]
      );
      if (!article[0]) {
        if (req.file) _tryUnlink(`/assets/news/${articleId}/${req.file.filename}`);
        return res.status(404).json({ error: 'Article not found', code: 404 });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'A file is required', code: 400 });
      }

      const kind = req.file.mimetype.startsWith('image/') ? 'image' : 'video_file';

      if (kind === 'image' && req.file.size > MAX_IMAGE_SIZE) {
        _tryUnlink(`/assets/news/${articleId}/${req.file.filename}`);
        return res.status(400).json({ error: 'Image file size must not exceed 10 MB', code: 400 });
      }

      const filePath  = `/assets/news/${articleId}/${req.file.filename}`;
      const caption   = req.body.caption || null;
      const sortOrder = req.body.sort_order ? parseInt(req.body.sort_order, 10) : 0;

      const { rows } = await db.query(
        `INSERT INTO news_media (article_id, kind, file_path, caption, sort_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${MEDIA_COLS}`,
        [articleId, kind, filePath, caption, sortOrder]
      );

      res.status(201).json(rows[0]);
    } catch (err) {
      if (req.file) _tryUnlink(`/assets/news/${req.params.id}/${req.file.filename}`);
      next(err);
    }
  },

  // ── POST /api/v1/news/:id/media/youtube ────────────────────────────────
  // Admin/moderator — add a YouTube video to an article.
  async addYouTube(req, res, next) {
    try {
      const articleId = parseInt(req.params.id, 10);
      if (!Number.isInteger(articleId)) return res.status(400).json({ error: 'invalid id', code: 400 });

      const { rows: article } = await db.query(
        'SELECT id FROM news_articles WHERE id = $1', [articleId]
      );
      if (!article[0]) return res.status(404).json({ error: 'Article not found', code: 404 });

      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required', code: 400 });
      }
      const youtubeId = parseYouTubeId(url);
      if (!youtubeId) {
        return res.status(400).json({ error: 'Could not parse a YouTube video ID from url', code: 400 });
      }

      const caption   = typeof req.body.caption === 'string' ? req.body.caption : null;
      const sortOrder = req.body.sort_order ? parseInt(req.body.sort_order, 10) : 0;

      const { rows } = await db.query(
        `INSERT INTO news_media (article_id, kind, youtube_id, caption, sort_order)
         VALUES ($1, 'youtube', $2, $3, $4) RETURNING ${MEDIA_COLS}`,
        [articleId, youtubeId, caption, sortOrder]
      );

      res.status(201).json(rows[0]);
    } catch (err) { next(err); }
  },

  // ── PATCH /api/v1/news/:id/media/:mediaId ──────────────────────────────
  // Admin/moderator — update caption of a media item.
  async updateMedia(req, res, next) {
    try {
      const articleId = parseInt(req.params.id, 10);
      const mediaId   = parseInt(req.params.mediaId, 10);
      if (!Number.isInteger(articleId) || !Number.isInteger(mediaId)) {
        return res.status(400).json({ error: 'invalid id', code: 400 });
      }

      const caption = req.body.caption !== undefined ? req.body.caption : undefined;
      if (caption === undefined) {
        return res.status(400).json({ error: 'No fields to update', code: 400 });
      }

      const { rows } = await db.query(
        `UPDATE news_media SET caption = $1 WHERE id = $2 AND article_id = $3 RETURNING ${MEDIA_COLS}`,
        [caption, mediaId, articleId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Media not found', code: 404 });
      res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // ── DELETE /api/v1/news/:id/media/:mediaId ─────────────────────────────
  // Admin/moderator — delete a media item (and its file from disk).
  async deleteMedia(req, res, next) {
    try {
      const articleId = parseInt(req.params.id, 10);
      const mediaId   = parseInt(req.params.mediaId, 10);
      if (!Number.isInteger(articleId) || !Number.isInteger(mediaId)) {
        return res.status(400).json({ error: 'invalid id', code: 400 });
      }

      const { rows } = await db.query(
        'DELETE FROM news_media WHERE id = $1 AND article_id = $2 RETURNING file_path',
        [mediaId, articleId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Media not found', code: 404 });

      _tryUnlink(rows[0].file_path);
      res.status(204).send();
    } catch (err) { next(err); }
  },

  // ── PUT /api/v1/news/:id/media/reorder ─────────────────────────────────
  // Admin/moderator — batch reorder media items.
  async reorderMedia(req, res, next) {
    try {
      const articleId = parseInt(req.params.id, 10);
      if (!Number.isInteger(articleId)) return res.status(400).json({ error: 'invalid id', code: 400 });

      const { order } = req.body; // [{ id, sort_order }, ...]

      const ids = order.map(item => Number(item.id));
      const { rows: existing } = await db.query(
        `SELECT id FROM news_media WHERE article_id = $1 AND id = ANY($2::int[])`,
        [articleId, ids]
      );
      if (existing.length !== ids.length) {
        return res.status(400).json({
          error: 'One or more media IDs do not belong to this article',
          code: 400,
        });
      }

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (const item of order) {
          await client.query(
            'UPDATE news_media SET sort_order = $1 WHERE id = $2 AND article_id = $3',
            [item.sort_order, item.id, articleId]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      const { rows } = await db.query(
        `SELECT ${MEDIA_COLS} FROM news_media WHERE article_id = $1 ORDER BY sort_order, id`,
        [articleId]
      );
      res.json(rows);
    } catch (err) { next(err); }
  },

  // ── GET /api/v1/news/admin/list ─────────────────────────────────────────
  // Admin/moderator — list ALL articles (published + drafts).
  async adminList(req, res, next) {
    try {
      const limit  = Math.min(parseInt(req.query.limit  ?? '50', 10), 100);
      const offset = Math.min(parseInt(req.query.offset ?? '0',  10), 1_000_000);

      const { rows } = await db.query(
        `SELECT ${ARTICLE_COLS}
         FROM   news_articles a
         LEFT JOIN users u ON u.id = a.author_id
         ORDER  BY a.created_at DESC
         LIMIT  $1 OFFSET $2`,
        [limit, offset]
      );

      const { rows: countRows } = await db.query(
        'SELECT COUNT(*)::int AS total FROM news_articles'
      );

      res.json({ articles: rows, total: countRows[0].total, limit, offset });
    } catch (err) { next(err); }
  },
};

module.exports = newsController;
