'use strict';

// ── Public-surface policy: which routes the business site advertises ────────
//
// Single source of truth for "hidden but functional". The routes listed here
// keep working at their URLs (SPA renders, APIs respond, admin surfaces stay
// reachable) but are removed from every discovery surface:
//   • nav/footer links      — public/js/components/NavBar.js, HomeView footer
//   • sitemap.xml           — server/routes/sitemapRoutes.js
//   • search indexing       — server/middleware/ssrMeta.js injects
//                             <meta name="robots" content="noindex, nofollow">
//
// Nothing here is deleted; per-module disposition (repurpose / flag / remove)
// is decided via ENHANCEMENTS.md with Halli's sign-off.
//
// The LIST is the product's, not the engine's: `identity.surface.hiddenRoutes`
// in config/client.json (server/config/clientConfig.js holds the defaults —
// Orange Smiley's set: /party (birthday landing + sub-routes), /halli and
// /about (personal bio), /news, /shop, the superseded /projects · /contact ·
// /privacy aliases, and /verkefni, hidden 2026-09-03 by Halli). A downstream
// that wants its shop or its news back lists fewer routes there; it never
// edits this file. This module was the hand-rolled ancestor of that seam.
const { identity } = require('./identity');
const HIDDEN_PUBLIC_ROUTES = identity.surface.hiddenRoutes.slice();

// Prefix-aware: '/news' hides '/news/some-slug' too. Locale prefixes are the
// caller's concern — pass the locale-stripped path (ssrMeta's `rest`, the
// sitemap's bare routes).
function isHiddenRoute(pathname) {
  if (!pathname) return false;
  return HIDDEN_PUBLIC_ROUTES.some(
    base => pathname === base || pathname.startsWith(base + '/')
  );
}

// The public IA (identity-seam-2, 2026-09-23): the ordered links after "Home"
// — `identity.surface.nav`, each `{ route, labelKey }` — minus anything the
// same product hides. A route in both lists would be linked from every page
// and noindexed at once; the hidden list wins, because "hidden" is the
// stronger statement. public/js/utils/identity.js `publicNav()` is the
// client twin; the sitemap (routes/sitemapRoutes.js) is built from this.
const PUBLIC_NAV = identity.surface.nav
  .filter(e => !isHiddenRoute(e.route))
  .map(e => ({ route: e.route, labelKey: e.labelKey }));

// The engine's legal pages: linked from the footer's legal row, in the
// sitemap, never in the top nav. A product that hides one hides it here too.
const LEGAL_ROUTES = ['/personuvernd', '/terms'].filter(r => !isHiddenRoute(r));

module.exports = { HIDDEN_PUBLIC_ROUTES, PUBLIC_NAV, LEGAL_ROUTES, isHiddenRoute };
