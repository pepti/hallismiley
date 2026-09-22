// Is this request for a file we serve straight off disk?
//
// The global rate limiter is mounted before express.static and the /assets/*
// upload mounts, so every stylesheet, script, font and image used to count
// against the same per-IP budget as real API calls. The router imports all 58
// view modules eagerly (ENHANCEMENTS #6), so one cold page load costs ~120
// sendfile requests before the Iceland scene renditions and the fonts are
// counted — the old 400/15 min budget 429'd ordinary browsing, which renders
// as broken images and an unstyled page.
//
// Static files are cheap — cached, served by sendFile, no DB — so exempting
// them costs nothing and makes the remaining budget mean what it says: API and
// page requests.
//
// The match is deliberately by LOCATION, not by file extension. Ice's first
// draft also exempted anything ending in a static-looking extension, which
// turned out to be a blanket bypass of the limiter: `/en/catalog.png` matched,
// express.static missed, the SSR catch-all bailed on its own extension check
// (middleware/ssrMeta.js) and returned a cheap 404 — unlimited, from any IP,
// on any path. Everything genuinely served from disk lives under one of the
// four prefixes below or is one of the three root files, so the location rule
// loses nothing and closes the hole (ice #201; base 2b6842c had the prefix
// half of this inline in app.js).
//
// Residual, accepted: a miss *inside* those prefixes (`/css/nope.png`) is
// still unlimited. It costs a 404 and nothing else — app.js's '/{*splat}'
// catch-all answers a miss under STATIC_PREFIX with a JSON 404 before the
// SSR/DB path, so KEEP THAT CHECK ON THIS SAME REGEX.

const STATIC_PREFIX = /^\/(assets|js|css|fonts)\//;
// Everything else in public/ that the shell references from the root.
const STATIC_ROOT_FILES = new Set(['/favicon.svg', '/manifest.json', '/og-image.jpg']);

/**
 * @param {import('express').Request} req
 * @returns {boolean} true when the request should skip the global limiter
 */
function isStaticAsset(req) {
  const p = req.path || '';
  return STATIC_PREFIX.test(p) || STATIC_ROOT_FILES.has(p);
}

module.exports = { isStaticAsset, STATIC_PREFIX, STATIC_ROOT_FILES };
