// Cache-Control for a file served out of public/ by express.static.
//
// Code and translations must always be revalidated. They live at URLs that
// never change between releases (/js/router.js is /js/router.js in every
// build), so a `max-age` lets the browser keep running the previous release's
// modules after a deploy. A reload within that window mixed releases: the
// locale JSON (fetched `cache: 'no-cache'`) came back new while the modules
// came from cache old. That is the page Orri was editing on 2026-09-15 — the
// 11 Sept order-page code, today's wording, and an order the server had
// locked the day before. `no-cache` keeps the ETag round-trip (a cheap 304 when
// nothing changed) and guarantees a reload runs code and strings from one
// release, which is what services/buildGuard.js relies on to reload a stale tab.
//
// A stamped release no longer loads its code from these URLs: the shell points
// at /js/_<tag>/… and /css/_<tag>/…, which middleware/versionedStatic.js serves
// immutable for a year — one release per URL, so caching cannot mix releases.
// The plain paths below remain for a local checkout (no stamp), a tab opened
// before that change, and anything that links a file directly.
//
// Everything else (fonts, images, the manifest) keeps express.static's maxAge.
//
// Returns the header value to set, or null to leave express.static's default.

const REVALIDATE = /\.(js|mjs|css|json)$/i;

function staticCacheControl(filePath, env = process.env.NODE_ENV) {
  const p = String(filePath || '');
  // The HTML entry point is never cached, in any environment.
  if (p.endsWith('index.html')) return 'no-cache, no-store, must-revalidate';
  if (!REVALIDATE.test(p)) return null;
  // Development: no-store, so an edited module is never served from cache.
  if (env !== 'production') return 'no-cache, no-store, must-revalidate';
  return 'no-cache';
}

module.exports = { staticCacheControl };
