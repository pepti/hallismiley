// GET /api/v1/admin/home — "Í dag", the admin home (D-020 step 4, 2026-09-26).
//
// Gate: a session plus the `dashboard` view, the same view the page itself
// needs (public/js/views/AdminView.js forwards a role without it to its first
// visible screen and never calls this). Behind the gate, WHAT is computed is
// decided per block from the views the role holds (services/adminHome.js) —
// the one-endpoint replacement for the old overview's seven calls, each of
// which carried its own gate.
//
// Which views count, in the same order the rest of the server asks:
//   1. the role set's views, 2FA-withheld (auth/requireView.js resolveViews);
//   2. minus a module this instance has switched off (config/modules.js) —
//      its screens do not exist here, for anyone;
//   3. minus, for an all-views holder only, the product's hidden admin views
//      (identity.surface.hiddenAdminViews — the sidebar's rule: an explicit
//      grant is always shown, a wildcard skips the hidden retail surface).
//
// A per-viewer answer is cached for CACHE_MS: the page prints "staðan kl.
// HH:MM", so a figure up to a minute old is honest, and a reload storm costs
// one computation. No polling anywhere. Off under NODE_ENV=test so every
// integration test reads the database it just wrote.
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../auth/middleware');
const { requireView, resolveViews } = require('../auth/requireView');
const { hasRole } = require('../auth/roles');
const { ALL } = require('../auth/adminViews');
const { disabledAdminViews } = require('../config/modules');
const { identity } = require('../config/identity');
const { buildHome } = require('../services/adminHome');

const CACHE_MS = process.env.NODE_ENV === 'test' ? 0 : 45_000;
const CACHE_MAX = 500;
const cache = new Map(); // key → { exp, body }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) { cache.delete(key); return null; }
  return hit.body;
}

function cacheSet(key, body) {
  if (!CACHE_MS) return;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // oldest first
  cache.set(key, { exp: Date.now() + CACHE_MS, body });
}

router.get('/', requireAuth, requireView('dashboard'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const views = await resolveViews(req);
    const all = views.includes(ALL);
    const disabled = new Set(disabledAdminViews());
    const hidden = new Set((identity.surface && identity.surface.hiddenAdminViews) || []);
    const instanceLacks = id => disabled.has(id) || (all && hidden.has(id));
    const can = id => !instanceLacks(id) && (all || views.includes(id));
    const isAdmin = hasRole(req.user, 'admin');

    const key = `${req.user.id}|${isAdmin ? 'a' : ''}|${[...views].sort().join(',')}|${[...disabled].sort().join(',')}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);

    const body = await buildHome({ can, instanceLacks, isAdmin, userId: req.user.id });
    cacheSet(key, body);
    return res.json(body);
  } catch (err) { next(err); }
});

module.exports = router;
