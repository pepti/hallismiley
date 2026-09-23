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

module.exports = { HIDDEN_PUBLIC_ROUTES, isHiddenRoute };
