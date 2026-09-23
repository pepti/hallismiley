'use strict';

// Route (locale-stripped) → scene image id — kept in step with the
// assignments in public/js/scenes/sceneDefs.js. Its own dependency-free module
// (identity-seam-2, 2026-09-23) so ssrMeta.js (the preload tag) and the e2e
// suite (iceland-scene.spec.js walks the nav routes that wear a scene) read
// one table without the spec pulling the middleware's database and template
// watcher into the Playwright runner.
const ROUTE_SCENE_IMAGES = {
  // No '/' entry: the home hero is a video again (2026-08-22 revert; the
  // clip is hero-dc7df since 2026-09-13) — preloading a 200KB+ AVIF the page never paints would burn the
  // LCP budget it was meant to protect.
  // iceland-v2 (2026-09-22): Halli's AI-generated set, one scene per page.
  '/thjonusta': 'canyon-river',
  '/verkefni': 'rhyolite-ridges',
  '/projects': 'rhyolite-ridges',
  '/um-okkur': 'glacier-tongue',
  '/hafa-samband': 'black-beach',
  '/contact': 'black-beach',
  '/personuvernd': 'cave-falls',
  '/privacy': 'cave-falls',
  '/terms': 'basalt-canyon',
  '/signup': 'moss-falls',
  '/forgot-password': 'snow-rapids',
  '/reset-password': 'snow-rapids',
  '/verify-email': 'snow-rapids',
  '/profile': 'hot-spring',
  // No 404 entry: an unmatched path has no route to key on here.
};

module.exports = { ROUTE_SCENE_IMAGES: Object.freeze(ROUTE_SCENE_IMAGES) };
