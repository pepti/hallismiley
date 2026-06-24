// Per-admin sidebar layout config. Auth + admin role required.
// GET / → { config } (saved layout, or null = default).
// PATCH / → persist { config }; { config: null } resets to default.
const express = require('express');
const router  = express.Router();

const AdminNavConfig  = require('../models/AdminNavConfig');
const { requireAuth } = require('../auth/middleware');
const { requireRole } = require('../auth/roles');
const { csrfProtect } = require('../middleware/csrf');

router.use(requireAuth, requireRole('admin'));

// Shape + size guard for the persisted layout snapshot. Routes/icons are never
// persisted (the frontend reconciles ids against the code-defined ADMIN_NAV).
function isValidLayout(layout) {
  if (!layout || typeof layout !== 'object' || layout.v !== 1) return false;
  if (!Array.isArray(layout.sections) || layout.sections.length > 50) return false;
  for (const s of layout.sections) {
    if (!s || typeof s !== 'object') return false;
    if (typeof s.key !== 'string' || s.key.length > 64) return false;
    if (s.title != null && (typeof s.title !== 'string' || s.title.length > 80)) return false;
    if (!Array.isArray(s.items) || s.items.length > 100) return false;
    if (s.items.some(it => typeof it !== 'string' || it.length > 64)) return false;
  }
  if (layout.labels != null) {
    if (typeof layout.labels !== 'object' || Array.isArray(layout.labels)) return false;
    const keys = Object.keys(layout.labels);
    if (keys.length > 100) return false;
    for (const k of keys) {
      if (k.length > 64) return false;
      const v = layout.labels[k];
      if (typeof v !== 'string' || v.length > 80) return false;
    }
  }
  // Optional personalization flags (collapsed/hidden sections + hidden lines).
  // Absent = default; the frontend reconciles meaning, so we just bound them.
  for (const f of ['collapsed', 'hiddenSections', 'hiddenItems']) {
    const a = layout[f];
    if (a == null) continue;
    if (!Array.isArray(a) || a.length > 100) return false;
    if (!a.every(s => typeof s === 'string' && s.length <= 64)) return false;
  }
  return true;
}

router.get('/', async (req, res, next) => {
  try {
    const config = await AdminNavConfig.getNavConfig(req.user.id);
    return res.json({ config: config ?? null });
  } catch (err) { return next(err); }
});

router.patch('/', csrfProtect, async (req, res, next) => {
  try {
    const incoming = (req.body || {}).config;
    if (incoming == null) {
      const cleared = await AdminNavConfig.setNavConfig(req.user.id, null);
      return res.json({ config: cleared ?? null });
    }
    if (!isValidLayout(incoming)) {
      return res.status(400).json({ error: 'Invalid navigation layout', code: 400 });
    }
    const saved = await AdminNavConfig.setNavConfig(req.user.id, incoming);
    return res.json({ config: saved ?? null });
  } catch (err) { return next(err); }
});

module.exports = router;
