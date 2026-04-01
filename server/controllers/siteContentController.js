const SiteContent = require('../models/SiteContent');

const siteContentController = {
  /** GET /api/v1/content — public, returns all content as { key: value } */
  async getAll(req, res, next) {
    try {
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
      res.json(await SiteContent.getAll());
    } catch (err) { next(err); }
  },

  /** PATCH /api/v1/content — admin/moderator only, upserts key/value pairs */
  async update(req, res, next) {
    try {
      const body = req.body;
      if (typeof body !== 'object' || Array.isArray(body) || !body) {
        return res.status(400).json({ error: 'Body must be a JSON object', code: 400 });
      }

      // Validate: all keys and values must be strings; reject unknown characters in keys
      for (const [key, value] of Object.entries(body)) {
        if (!/^[a-z][a-z0-9_]*$/.test(key)) {
          return res.status(400).json({ error: `Invalid content key: ${key}`, code: 400 });
        }
        if (typeof value !== 'string') {
          return res.status(400).json({ error: `Value for key "${key}" must be a string`, code: 400 });
        }
        if (value.length > 5000) {
          return res.status(400).json({ error: `Value for key "${key}" exceeds 5000 characters`, code: 400 });
        }
      }

      await SiteContent.setMany(body, req.user.id);
      res.json(await SiteContent.getAll());
    } catch (err) { next(err); }
  },
};

module.exports = siteContentController;
