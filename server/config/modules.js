'use strict';

// ── Module switches, resolved (R4, 2026-09-24) ───────────────────────────────
//
// `clientConfig.modules` says which switchable modules this instance has
// (`preset` + `modules.<id>.enabled`); server/config/moduleCatalog.js says
// what each one owns. This module is the one server-side reader that joins
// the two, and every surface asks it:
//
//   • moduleGate            app.js, mounted before body parsing and auth —
//                           a disabled module's API and upload prefixes 404
//                           with the error envelope (absent, not forbidden);
//   • isDisabledRoute()     app.js's SPA catch-all (a real 404 status) and
//                           config/publicSurface.js (off nav, sitemap and
//                           the index: a disabled route is hidden a fortiori);
//   • DISABLED_ADMIN_VIEWS  the role editor's grantable list
//                           (controllers/adminRolesController.js);
//   • modulesScriptTag()    ssrMeta.js's `<script id="modules">` hand-off,
//                           read by public/js/utils/modules.js for the SPA
//                           router, the nav's cart and the admin sidebar;
//   • moduleSummary()       the MCP `environment_info` tool.
//
// The pure core (`moduleState`) takes the config and the catalogue as
// arguments so the unit tier can exercise any preset without re-requiring
// the app (tests/unit/moduleCatalog.test.js).

const { clientConfig } = require('./clientConfig');
const { MODULES, MODULE_IDS } = require('./moduleCatalog');

/** '/shop' matches '/shop' and '/shop/x', never '/shopping'. Case-insensitive,
 *  because Express routing is: '/API/V1/Shop/products' reaches the shop router,
 *  so a case-sensitive gate would let it straight past a switched-off module
 *  (invariant-reviewer, 2026-09-24; app.js LARGE_BODY_PATH has the same note). */
function underPrefix(pathname, prefix) {
  const p = pathname.toLowerCase();
  const q = prefix.toLowerCase();
  return p === q || p.startsWith(q + '/');
}

/**
 * The owner of a path among `field` ('routes' | 'api' | 'assets'): the module
 * with the LONGEST matching prefix, so the till's '/api/v1/admin/bookkeeping
 * /pos' beats bókhald's '/api/v1/admin/bookkeeping'. Null when no module
 * claims it (a core path).
 */
function ownerOf(pathname, field, catalog = MODULES) {
  let best = null;
  let bestLen = -1;
  for (const [id, m] of Object.entries(catalog)) {
    for (const prefix of m[field] || []) {
      if (prefix.length > bestLen && underPrefix(pathname, prefix)) { best = id; bestLen = prefix.length; }
    }
  }
  return best;
}

/**
 * Everything the readers need, from a resolved config and a catalogue.
 * @returns {{ preset: string, enabled: Object<string, boolean>,
 *   disabled: string[], disabledRoutes: string[], disabledAdminViews: string[],
 *   isEnabled(id): boolean, isDisabledRoute(route): boolean,
 *   isDisabledRequestPath(path): boolean }}
 */
function moduleState(config = clientConfig, catalog = MODULES) {
  const mods = (config && config.modules) || {};
  const enabled = {};
  for (const id of Object.keys(catalog)) enabled[id] = !(mods[id] && mods[id].enabled === false);
  const disabled = Object.keys(catalog).filter(id => !enabled[id]);

  const disabledRoutes = [];
  const disabledAdminViews = [];
  for (const id of disabled) {
    disabledRoutes.push(...catalog[id].routes);
    disabledAdminViews.push(...catalog[id].adminViews);
  }

  const isEnabled = id => enabled[id] !== false;
  // A route belongs to its longest-prefix owner: with bókhald off and the
  // till on, '/admin/books/pos' stays up while '/admin/books' goes.
  const isDisabledRoute = (route) => {
    if (!route) return false;
    const owner = ownerOf(route, 'routes', catalog);
    return owner !== null && !enabled[owner];
  };
  const isDisabledRequestPath = (pathname) => {
    if (!pathname) return false;
    const owner = ownerOf(pathname, 'api', catalog) || ownerOf(pathname, 'assets', catalog);
    return owner !== null && !enabled[owner];
  };

  return {
    preset: typeof mods.preset === 'string' ? mods.preset : 'all',
    enabled, disabled, disabledRoutes, disabledAdminViews,
    isEnabled, isDisabledRoute, isDisabledRequestPath,
  };
}

// ── This instance ────────────────────────────────────────────────────────────

const state = moduleState();

const isModuleEnabled = state.isEnabled;
const isDisabledRoute = state.isDisabledRoute;
const DISABLED_ADMIN_VIEWS = Object.freeze(state.disabledAdminViews.slice());

/**
 * Express middleware: a request under a disabled module's API or upload
 * prefix is answered 404 here, before the body parser, the limiters, CSRF and
 * auth see it — an anonymous probe learns nothing, an admin learns nothing
 * more (the self-update switch's rule, tests/integration/selfUpdateDisabled
 * .test.js). Same envelope as the SPA catch-all's API miss.
 */
function moduleGate(req, res, next) {
  if (state.disabled.length && state.isDisabledRequestPath(req.path)) {
    return res.status(404).json({ error: 'Not found', code: 404 });
  }
  return next();
}

/** What the SPA needs: the switches, every catalogued SPA route → whether its
 *  module is on (the client resolves longest-prefix exactly like
 *  isDisabledRoute, so the till survives bókhald being off), and the admin
 *  views to drop. No API or upload prefixes — the browser never gates those. */
function moduleHandoff(s = state, catalog = MODULES) {
  const routes = {};
  for (const [id, m] of Object.entries(catalog)) for (const r of m.routes) routes[r] = s.enabled[id] !== false;
  return {
    preset: s.preset,
    enabled: { ...s.enabled },
    routes,
    disabledAdminViews: s.disabledAdminViews.slice(),
  };
}

/** `<script id="modules" type="application/json">` — escaped like the
 *  identity hand-off (config/identity.js identityScriptTag). */
function modulesScriptTag(s = state) {
  const json = JSON.stringify(moduleHandoff(s))
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '\\u003c!--');
  return `<script id="modules" type="application/json">${json}</script>`;
}

/** For the MCP environment_info tool: the preset and the enabled set. */
function moduleSummary(s = state) {
  return { preset: s.preset, enabled: MODULE_IDS.filter(id => s.enabled[id]) };
}

module.exports = {
  moduleState,
  ownerOf,
  underPrefix,
  isModuleEnabled,
  isDisabledRoute,
  DISABLED_ADMIN_VIEWS,
  moduleGate,
  moduleHandoff,
  modulesScriptTag,
  moduleSummary,
};
