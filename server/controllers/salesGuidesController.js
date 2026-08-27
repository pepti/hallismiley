const db  = require('../config/database');
const { t } = require('../i18n');

// Handbók sölufólks — internal sales-staff guides (migration 090).
//
// Locale convention is INVERTED relative to news_articles: guides are
// Icelandic-canonical (title/summary/body ARE the IS copy) with optional
// `_en` siblings, so the resolver coalesces for 'en' readers instead of 'is'.
//
// Everything here is internal-only: read endpoints sit behind
// requireView('handbok'), writes behind admin/moderator — and every response
// is `Cache-Control: no-store` so internal material never lands in a shared
// cache (deliberately NOT the public news cache headers).

const SECTIONS = ['grunnur', 'sala', 'thjonusta', 'vara'];

function guideCols(locale) {
  if (locale === 'en') {
    return `
      g.id,
      COALESCE(g.title_en,   g.title)   AS title,
      g.slug, g.section,
      COALESCE(g.summary_en, g.summary) AS summary,
      COALESCE(g.body_en,    g.body)    AS body,
      g.sort_order, g.published, g.published_at,
      g.created_at, g.updated_at
    `;
  }
  return `
    g.id, g.title, g.slug, g.section, g.summary, g.body,
    g.sort_order, g.published, g.published_at,
    g.created_at, g.updated_at
  `;
}

// Editor surface returns BOTH locales' raw columns (IS canonical + EN
// siblings side-by-side), plus authorship for the audit trail.
const GUIDE_COLS_BOTH = `
  g.id, g.title, g.slug, g.section, g.summary, g.body,
  g.title_en, g.summary_en, g.body_en,
  g.sort_order, g.published, g.published_at,
  g.created_by, g.updated_by, g.created_at, g.updated_at,
  u.display_name AS updated_by_name
`;

function _slugify(title) {
  return title
    .toLowerCase()
    .replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
    .replace(/[óòôö]/g, 'o').replace(/[úùûü]/g, 'u').replace(/[ýÿ]/g, 'y')
    .replace(/æ/g, 'ae').replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/ö/g, 'o')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

async function _uniqueSlug(base, excludeId = null) {
  let candidate = base;
  let suffix    = 2;
  let found     = false;
  while (!found) {
    const { rows } = await db.query(
      `SELECT id FROM sales_guides WHERE slug = $1${excludeId ? ' AND id <> $2' : ''}`,
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

function _noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}

const salesGuidesController = {

  // ── GET /api/v1/admin/handbok ───────────────────────────────────────────
  // requireView('handbok') — published guides only, locale-resolved, grouped
  // client-side by section (ordered here so the client need not sort).
  async list(req, res, next) {
    try {
      _noStore(res);
      const { rows } = await db.query(
        `SELECT ${guideCols(req.locale)}
         FROM   sales_guides g
         WHERE  g.published = TRUE
         ORDER  BY g.section, g.sort_order, g.id`
      );
      res.json({ guides: rows, sections: SECTIONS });
    } catch (err) { next(err); }
  },

  // ── GET /api/v1/admin/handbok/manage ────────────────────────────────────
  // Admin/moderator — ALL guides (drafts included), both locales raw.
  async manageList(req, res, next) {
    try {
      _noStore(res);
      const { rows } = await db.query(
        `SELECT ${GUIDE_COLS_BOTH}
         FROM   sales_guides g
         LEFT JOIN users u ON u.id = g.updated_by
         ORDER  BY g.section, g.sort_order, g.id`
      );
      res.json({ guides: rows, sections: SECTIONS });
    } catch (err) { next(err); }
  },

  // ── GET /api/v1/admin/handbok/:slug ─────────────────────────────────────
  // requireView('handbok') — single PUBLISHED guide; drafts 404 here.
  async getOne(req, res, next) {
    try {
      _noStore(res);
      const { rows } = await db.query(
        `SELECT ${guideCols(req.locale)}
         FROM   sales_guides g
         WHERE  g.slug = $1 AND g.published = TRUE`,
        [req.params.slug]
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.handbok.guideNotFound'), code: 404 });
      res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // ── GET /api/v1/admin/handbok/:slug/preview ─────────────────────────────
  // Admin/moderator — any guide (draft or published), both locales raw.
  async preview(req, res, next) {
    try {
      _noStore(res);
      const { rows } = await db.query(
        `SELECT ${GUIDE_COLS_BOTH}
         FROM   sales_guides g
         LEFT JOIN users u ON u.id = g.updated_by
         WHERE  g.slug = $1`,
        [req.params.slug]
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.handbok.guideNotFound'), code: 404 });
      res.json(rows[0]);
    } catch (err) { next(err); }
  },

  // ── POST /api/v1/admin/handbok ──────────────────────────────────────────
  // Admin/moderator — create a guide (IS fields canonical/required).
  async create(req, res, next) {
    try {
      _noStore(res);
      const {
        title, summary = null, body,
        title_en = null, summary_en = null, body_en = null,
        section = 'grunnur', sort_order = 0, published = false,
      } = req.body;

      const rawSlug = req.body.slug
        ? String(req.body.slug).toLowerCase().replace(/[^\w-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
        : _slugify(title);
      const slug = await _uniqueSlug(rawSlug);

      const published_at = published ? new Date().toISOString() : null;

      const { rows } = await db.query(
        `INSERT INTO sales_guides
           (title, slug, section, summary, body,
            title_en, summary_en, body_en,
            sort_order, published, published_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
         RETURNING *`,
        [title, slug, section, summary, body,
         title_en, summary_en, body_en,
         sort_order, published, published_at, req.user.id]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'sales_guides_slug_key') {
        return res.status(409).json({ error: t(req.locale, 'errors.handbok.slugTaken'), code: 409 });
      }
      next(err);
    }
  },

  // ── PATCH /api/v1/admin/handbok/:id ─────────────────────────────────────
  // Admin/moderator — partial update; published_at stamped on first publish.
  async update(req, res, next) {
    try {
      _noStore(res);
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: t(req.locale, 'errors.handbok.invalidId'), code: 400 });

      const { rows: existing } = await db.query(
        'SELECT * FROM sales_guides WHERE id = $1', [id]
      );
      if (!existing[0]) return res.status(404).json({ error: t(req.locale, 'errors.handbok.guideNotFound'), code: 404 });
      const current = existing[0];

      const title      = req.body.title      !== undefined ? req.body.title      : current.title;
      const summary    = req.body.summary    !== undefined ? req.body.summary    : current.summary;
      const body       = req.body.body       !== undefined ? req.body.body       : current.body;
      const title_en   = req.body.title_en   !== undefined ? req.body.title_en   : current.title_en;
      const summary_en = req.body.summary_en !== undefined ? req.body.summary_en : current.summary_en;
      const body_en    = req.body.body_en    !== undefined ? req.body.body_en    : current.body_en;
      const section    = req.body.section    !== undefined ? req.body.section    : current.section;
      const sort_order = req.body.sort_order !== undefined ? req.body.sort_order : current.sort_order;
      const published  = req.body.published  !== undefined ? req.body.published  : current.published;

      let slug = current.slug;
      if (req.body.slug !== undefined) {
        const rawSlug = String(req.body.slug).toLowerCase().replace(/[^\w-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
        slug = await _uniqueSlug(rawSlug, id);
      }

      let published_at = current.published_at;
      if (published && !current.published_at) {
        published_at = new Date().toISOString();
      }

      const { rows } = await db.query(
        `UPDATE sales_guides
         SET title = $1, slug = $2, section = $3, summary = $4, body = $5,
             title_en = $6, summary_en = $7, body_en = $8,
             sort_order = $9, published = $10, published_at = $11,
             updated_by = $12
         WHERE id = $13
         RETURNING *`,
        [title, slug, section, summary, body,
         title_en, summary_en, body_en,
         sort_order, published, published_at, req.user.id, id]
      );
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'sales_guides_slug_key') {
        return res.status(409).json({ error: t(req.locale, 'errors.handbok.slugTaken'), code: 409 });
      }
      next(err);
    }
  },

  // ── PUT /api/v1/admin/handbok/reorder ───────────────────────────────────
  // Admin/moderator — batch move/reorder in one transaction.
  async reorder(req, res, next) {
    try {
      _noStore(res);
      const { order } = req.body; // [{ id, section?, sort_order }, ...]

      const ids = order.map(item => Number(item.id));
      const { rows: existing } = await db.query(
        'SELECT id FROM sales_guides WHERE id = ANY($1::int[])', [ids]
      );
      if (existing.length !== ids.length) {
        return res.status(400).json({ error: t(req.locale, 'errors.handbok.unknownGuideId'), code: 400 });
      }

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        for (const item of order) {
          if (item.section !== undefined) {
            await client.query(
              'UPDATE sales_guides SET sort_order = $1, section = $2, updated_by = $3 WHERE id = $4',
              [item.sort_order, item.section, req.user.id, item.id]
            );
          } else {
            await client.query(
              'UPDATE sales_guides SET sort_order = $1, updated_by = $2 WHERE id = $3',
              [item.sort_order, req.user.id, item.id]
            );
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      const { rows } = await db.query(
        `SELECT ${GUIDE_COLS_BOTH}
         FROM   sales_guides g
         LEFT JOIN users u ON u.id = g.updated_by
         ORDER  BY g.section, g.sort_order, g.id`
      );
      res.json({ guides: rows, sections: SECTIONS });
    } catch (err) { next(err); }
  },

  // ── DELETE /api/v1/admin/handbok/:id ────────────────────────────────────
  // Admin ONLY — hard delete. Moderators unpublish instead (PATCH published:false).
  async remove(req, res, next) {
    try {
      _noStore(res);
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: t(req.locale, 'errors.handbok.invalidId'), code: 400 });

      const { rows } = await db.query(
        'DELETE FROM sales_guides WHERE id = $1 RETURNING id', [id]
      );
      if (!rows[0]) return res.status(404).json({ error: t(req.locale, 'errors.handbok.guideNotFound'), code: 404 });
      res.status(204).send();
    } catch (err) { next(err); }
  },
};

module.exports = salesGuidesController;
