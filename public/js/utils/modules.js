// Module switches on the client (R4, 2026-09-24) — the browser half of
// server/config/modules.js.
//
// ssrMeta.js writes `<script id="modules" type="application/json">` next to
// the identity hand-off: { preset, enabled: { shop: true, … }, routes:
// { '/shop': true, '/admin/books': false, … }, disabledAdminViews: [...] }.
// This module parses it ONCE. Readers: the router (a disabled module's page
// renders the not-found view), utils/identity.js (a disabled route is hidden
// — off the nav and footers), NavBar (the cart icon is the shop's), the admin
// sidebar (a disabled module's items are unavailable, even in edit mode).
//
// UX only. The server already 404s every API of a disabled module before
// auth (invariant 8: server-side gating first) — this just keeps the SPA from
// offering what is not there.
//
// No hand-off (a shell served without SSR, the node test environment) means
// every module on: the engine's behaviour before the switches existed.

function read() {
  try {
    const el = typeof document !== 'undefined' && typeof document.getElementById === 'function'
      ? document.getElementById('modules')
      : null;
    if (!el) return null;
    const v = JSON.parse(el.textContent || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Normalise a hand-off record (exported for the unit test). Anything missing
 * or malformed falls back to "on".
 */
export function normalizeModules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const enabled = {};
  if (r.enabled && typeof r.enabled === 'object') {
    for (const [id, on] of Object.entries(r.enabled)) enabled[id] = on !== false;
  }
  const routes = {};
  if (r.routes && typeof r.routes === 'object') {
    for (const [route, on] of Object.entries(r.routes)) {
      if (typeof route === 'string' && route.startsWith('/')) routes[route] = on !== false;
    }
  }
  const disabledAdminViews = Array.isArray(r.disabledAdminViews)
    ? r.disabledAdminViews.filter((v) => typeof v === 'string')
    : [];
  return {
    preset: typeof r.preset === 'string' ? r.preset : 'all',
    enabled,
    routes,
    disabledAdminViews,
  };
}

/**
 * Does `route` (bare, locale-stripped) belong to a switched-off module? The
 * LONGEST catalogued prefix decides, on a '/' boundary, ignoring case — exactly as
 * server/config/modules.js isDisabledRoute, so '/admin/books/pos' follows the
 * till while '/admin/books' follows bókhald.
 */
export function routeDisabledIn(state, route) {
  if (!route) return false;
  // Case-insensitive, like the server's gate (Express routing ignores case).
  const r = route.toLowerCase();
  let best = null;
  for (const prefix of Object.keys(state.routes)) {
    const p = prefix.toLowerCase();
    if ((r === p || r.startsWith(p + '/')) && (!best || prefix.length > best.length)) best = prefix;
  }
  return best !== null && state.routes[best] === false;
}

const STATE = Object.freeze(normalizeModules(read()));

/** Is module `id` on here? Unknown ids are on (a core surface). */
export function moduleEnabled(id) {
  return STATE.enabled[id] !== false;
}

/** Does this bare route belong to a module this instance does not have? */
export function isDisabledRoute(route) {
  return routeDisabledIn(STATE, route);
}

/** Admin view ids whose module is off — never shown, never arranged. */
export const DISABLED_ADMIN_VIEWS = Object.freeze(STATE.disabledAdminViews.slice());
