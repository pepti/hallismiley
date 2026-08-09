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
// is decided via ENHANCEMENTS.md with Halli's sign-off. This module is also
// the seed of the future `client.config` module-flag system (plan §4).
const HIDDEN_PUBLIC_ROUTES = [
  '/party',      // birthday landing (+ /party/admin, /party/login, …)
  '/halli',      // personal bio
  '/about',      // alias of /halli
  '/news',       // portfolio news presentation
  '/shop',       // storefront (capability retained; not part of the public IA yet)
  '/projects',   // superseded by /verkefni
  '/contact',    // superseded by /hafa-samband
  '/privacy',    // superseded by /personuvernd
];

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
