// The route list for the role × route harness (e2e/roles/*.spec.js), DERIVED
// from the engine's own sources so it cannot drift from the app:
//
//   • public/js/router.js ROUTES — every SPA pattern, the view it renders and
//     the guard its factory applies (canSeeView('<id>') / isAdmin() /
//     isAuthenticated()). Cross-checked against public/js/routePatterns.json
//     (the server's copy): a pattern the parse misses fails the harness at
//     load, it never silently shrinks the matrix.
//   • server/auth/adminViews.js — the canonical view ids a guard may name.
//   • server/config/modules.js — a route of a module this instance does not
//     have 404s by design; it is reported as skipped, not visited.
//   • the feature registry + features/local.json (e2e/lib/featureGate.js) — a
//     route whose view belongs to a feature this product hides, disables or
//     forks is skipped with the note, so a downstream does not go red on a
//     hidden module.
//
// Ported from icelandicstore #62 (e2e/lib/routes.js), where the lists were
// hand-kept per role; harvest 2 lane 9, 2026-09-26.
const fs = require('fs');
const path = require('path');
const { ADMIN_VIEW_IDS } = require('../../server/auth/adminViews');
const { isDisabledRoute } = require('../../server/config/modules');
const gateCore = require('../../tests/lib/featureGate');

const ROOT = path.join(__dirname, '../..');
const ROUTER = path.join(ROOT, 'public/js/router.js');
const PATTERNS = path.join(ROOT, 'public/js/routePatterns.json');

/** Parse router.js ROUTES → [{ pattern, view, guard }]. */
function parseRouter(raw = fs.readFileSync(ROUTER, 'utf8')) {
  const src = raw.split('\r\n').join('\n'); // a Windows checkout is CRLF
  const start = src.indexOf('const ROUTES = [');
  const end = src.indexOf('\n];', start);
  if (start < 0 || end < 0) throw new Error('routes.js: cannot find `const ROUTES = [ … ];` in public/js/router.js');
  const out = [];
  for (const line of src.slice(start, end).split('\n')) {
    const m = line.match(/^\s*\{\s*pattern:\s*'([^']+)',\s*factory:(.*)$/);
    if (!m) continue;
    const [, pattern, body] = m;
    const viewM = body.match(/make\('(\w+)'/);
    const view = viewM ? viewM[1] : (/new HomeView\(\)/.test(body) ? 'HomeView' : null);
    const seeView = body.match(/canSeeView\('([a-z]+)'\)/);
    let guard = { kind: 'public' };
    if (seeView) guard = { kind: 'view', view: seeView[1] };
    else if (/isAdmin\(\)/.test(body)) guard = { kind: 'admin' };
    else if (/isAuthenticated\(\)/.test(body)) guard = { kind: 'signedIn' };
    out.push({ pattern, view, guard });
  }
  return out;
}

function loadRoutes() {
  const routes = parseRouter();
  const listed = JSON.parse(fs.readFileSync(PATTERNS, 'utf8')).patterns;
  const parsed = routes.map((r) => r.pattern);
  const missing = listed.filter((p) => !parsed.includes(p));
  const extra = parsed.filter((p) => !listed.includes(p));
  if (missing.length || extra.length) {
    throw new Error(`routes.js: router.js parse disagrees with routePatterns.json — missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`);
  }
  for (const r of routes) {
    if (r.guard.kind === 'view' && !ADMIN_VIEW_IDS.includes(r.guard.view)) {
      throw new Error(`routes.js: ${r.pattern} is guarded by canSeeView('${r.guard.view}'), which server/auth/adminViews.js does not know`);
    }
  }
  return routes;
}

/** Why a route is not visited here, or null. */
function skipReason(route) {
  if (isDisabledRoute(route.pattern)) return `${route.pattern}: its module is switched off on this instance (a 404 by design)`;
  if (route.view) {
    const file = path.join(ROOT, 'public/js/views', `${route.view}.js`);
    const g = gateCore.defaultGate().gateForSpec(file);
    if (g.skip) return `${route.pattern}: ${g.reason}`;
  }
  return null;
}

const ALL = loadRoutes();
// Only routes a person can type: a `:param` needs a real id.
const concrete = ALL.filter((r) => !r.pattern.includes(':'));
const isAdminPath = (p) => p === '/admin' || p.startsWith('/admin/');

/** Public SPA routes (not /admin): every role should see each render cleanly. */
const PUBLIC_ROUTES = concrete.filter((r) => !isAdminPath(r.pattern));
/** Admin routes: `guard` says who may open each. */
const ADMIN_ROUTES = concrete.filter((r) => isAdminPath(r.pattern));

/**
 * May a holder of `views` (a role's resolved view list; `['*']` = admin) open
 * this admin route? `/admin` itself is special: AdminView forwards a role
 * without `dashboard` to its first sidebar item, or home.
 */
function mayOpen(route, { views, isAdmin }) {
  const g = route.guard;
  if (isAdmin) return true;
  if (g.kind === 'admin') return false;
  if (g.kind === 'view') return views.includes('*') || views.includes(g.view);
  // `/admin` (signedIn) — AdminView itself decides; `/admin/projects` has an
  // editor carve-out (canEdit) the harness roles do not hold.
  return false;
}

module.exports = { ALL, PUBLIC_ROUTES, ADMIN_ROUTES, parseRouter, loadRoutes, skipReason, mayOpen, isAdminPath };
