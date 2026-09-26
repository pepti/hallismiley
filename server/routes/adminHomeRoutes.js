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
// A per-viewer answer is cached briefly (services/adminHomeCache.js — the key,
// the TTL and what is never cached are documented there). No polling anywhere.
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../auth/middleware');
const { requireView, resolveViews } = require('../auth/requireView');
const { hasRole } = require('../auth/roles');
const { disabledAdminViews } = require('../config/modules');
const { identity } = require('../config/identity');
const { buildHome, homeAccess } = require('../services/adminHome');
const { cacheKey, cacheGet, cacheSet } = require('../services/adminHomeCache');

router.get('/', requireAuth, requireView('dashboard'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const views = await resolveViews(req);
    const disabledList = disabledAdminViews();
    const { can, instanceLacks } = homeAccess({
      views,
      disabled: disabledList,
      hidden: (identity.surface && identity.surface.hiddenAdminViews) || [],
    });
    const isAdmin = hasRole(req.user, 'admin');

    const key = cacheKey(req.user, views, disabledList, isAdmin);
    const cached = cacheGet(key);
    if (cached) return res.json(cached);

    const body = await buildHome({ can, instanceLacks, isAdmin, userId: req.user.id });
    cacheSet(key, body);
    return res.json(body);
  } catch (err) { next(err); }
});

module.exports = router;
