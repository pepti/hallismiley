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
//   • disabledAdminViews()  the role editor's grantable list
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
//
// Two layers, like self-update's settings (services/selfUpdateSettings.js):
//   1. the CONTRACT — config/client.json + CLIENT_CONFIG_* (the preset and the
//      explicit switches), resolved once at boot: what this instance was
//      provisioned (and is billed) to have;
//   2. the ADMIN's switches (R5b, 2026-09-24) — app_settings `modules.admin_off`,
//      a list of contracted modules the instance's admin (by hand, or Claude
//      over the MCP `set_module` tool) has switched OFF. It can only narrow
//      the contract, never widen it: turning on a module the contract leaves
//      off would hand out a tier nobody bought.
// The state below is recomputed whenever layer 2 changes, and every reader
// asks through a function, so a switch takes effect at once in this process —
// no restart. Layer 2 is loaded at boot after the migrations
// (loadAdminSwitches, server.js) and on every write here; on a scaled-out
// deployment each instance re-reads it at its next boot.

const ADMIN_OFF_KEY = 'modules.admin_off';

const contract = moduleState();
let adminOff = new Set();
let current = contract;

function recompute() {
  const mods = {};
  for (const id of MODULE_IDS) mods[id] = { enabled: contract.enabled[id] !== false && !adminOff.has(id) };
  current = moduleState({ modules: { ...mods, preset: contract.preset } });
}

function isModuleEnabled(id) { return current.isEnabled(id); }
function isDisabledRoute(route) { return current.isDisabledRoute(route); }
/** Admin view ids whose module is off right now (contract or admin). */
function disabledAdminViews() { return current.disabledAdminViews.slice(); }

/**
 * Express middleware: a request under a disabled module's API or upload
 * prefix is answered 404 here, before the body parser, the limiters, CSRF and
 * auth see it — an anonymous probe learns nothing, an admin learns nothing
 * more (the self-update switch's rule, tests/integration/selfUpdateDisabled
 * .test.js). Same envelope as the SPA catch-all's API miss.
 */
function moduleGate(req, res, next) {
  if (current.disabled.length && current.isDisabledRequestPath(req.path)) {
    return res.status(404).json({ error: 'Not found', code: 404 });
  }
  return next();
}

/** What the SPA needs: the switches, every catalogued SPA route → whether its
 *  module is on (the client resolves longest-prefix exactly like
 *  isDisabledRoute, so the till survives bókhald being off), and the admin
 *  views to drop. No API or upload prefixes — the browser never gates those. */
function moduleHandoff(s = current, catalog = MODULES) {
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
function modulesScriptTag(s = current) {
  const json = JSON.stringify(moduleHandoff(s))
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '\\u003c!--');
  return `<script id="modules" type="application/json">${json}</script>`;
}

/** For MCP: the preset, what is on, what the contract allows, and what the
 *  admin has switched off within it. */
function moduleSummary(s = current) {
  return {
    preset: s.preset,
    enabled: MODULE_IDS.filter(id => s.enabled[id]),
    contract: MODULE_IDS.filter(id => contract.enabled[id]),
    switched_off: MODULE_IDS.filter(id => adminOff.has(id)),
  };
}

/** Only contracted, known ids survive a stored list (a hand-edited row, or a
 *  module the contract has since dropped, is ignored). */
function cleanOffList(list) {
  return Array.isArray(list)
    ? [...new Set(list.filter(id => typeof id === 'string' && MODULE_IDS.includes(id) && contract.enabled[id]))]
    : [];
}

/** Load layer 2 from app_settings. Called at boot, after the migrations; a
 *  failure keeps the contract (logged by the caller). */
async function loadAdminSwitches() {
  const Setting = require('../models/Setting');
  adminOff = new Set(cleanOffList(await Setting.get(ADMIN_OFF_KEY)));
  recompute();
  return moduleSummary();
}

/**
 * Switch a contracted module off, or back on (R5b). Persists layer 2 and
 * applies it at once. Refuses an unknown id and — the rule that keeps a tier
 * a tier — switching ON a module the contract does not include.
 * @returns {Promise<{ ok: true, summary } | { ok: false, error: string }>}
 */
// Switches are a read-modify-write of one stored list, so they are made one
// at a time (a promise chain in this process) and each one re-reads the
// stored row under a row lock inside a transaction (another instance, or a
// boot load that failed and left memory empty, can never be overwritten from
// a stale copy). Security review 2026-09-24: two toggles in flight together
// used to lose one.
let switchQueue = Promise.resolve();

async function setModuleSwitch(id, enabled) {
  if (!MODULE_IDS.includes(id)) return { ok: false, error: `unknown module: ${id} (one of ${MODULE_IDS.join(', ')})` };
  if (typeof enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean' };
  if (!contract.enabled[id]) {
    return { ok: false, error: `${id} is not in this instance's contract (preset "${contract.preset}"); it can only be added by changing config/client.json` };
  }
  const run = switchQueue.then(() => writeSwitch(id, enabled));
  switchQueue = run.catch(() => {}); // a failed switch must not wedge the queue
  return run;
}

async function writeSwitch(id, enabled) {
  const { pool } = require('./database');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, '[]'::jsonb) ON CONFLICT (key) DO NOTHING`,
      [ADMIN_OFF_KEY]
    );
    const { rows } = await client.query('SELECT value FROM app_settings WHERE key = $1 FOR UPDATE', [ADMIN_OFF_KEY]);
    const next = new Set(cleanOffList(rows[0] && rows[0].value));
    if (enabled) next.delete(id); else next.add(id);
    await client.query(
      'UPDATE app_settings SET value = $2::jsonb, updated_at = NOW() WHERE key = $1',
      [ADMIN_OFF_KEY, JSON.stringify([...next].sort())]
    );
    await client.query('COMMIT');
    adminOff = next;
    recompute();
    return { ok: true, summary: moduleSummary() };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Tests: drop layer 2 from memory (the stored row is the test's to clear). */
function resetAdminSwitchesForTests() {
  adminOff = new Set();
  recompute();
}

module.exports = {
  moduleState,
  ownerOf,
  underPrefix,
  isModuleEnabled,
  isDisabledRoute,
  disabledAdminViews,
  moduleGate,
  moduleHandoff,
  modulesScriptTag,
  moduleSummary,
  loadAdminSwitches,
  setModuleSwitch,
  resetAdminSwitchesForTests,
  ADMIN_OFF_KEY,
};
