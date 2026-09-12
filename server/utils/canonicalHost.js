'use strict';

/**
 * The host every production request is 301'd to (server/app.js).
 *
 * Derived from APP_URL — the same setting ssrMeta.js, sitemapRoutes.js and
 * emailService.js already treat as the site's origin — so an instance
 * scaffolded from this base onto another domain does not redirect every
 * request to hallismiley.is the moment NODE_ENV=production is set. Until
 * 2026-09-12 the host was a literal in app.js, which is exactly what happened
 * on orangesmiley.
 *
 * Only the host is used (scheme is forced to https by the redirect itself);
 * a port survives so a local production-mode boot on :3000 still works.
 * Anything unparsable falls back to the base's own host, matching ssrMeta.
 */
const DEFAULT_HOST = 'www.hallismiley.is';

function resolveCanonicalHost(appUrl, fallback = DEFAULT_HOST) {
  if (typeof appUrl !== 'string' || appUrl.trim() === '') return fallback;
  try {
    const host = new URL(appUrl.trim()).host.toLowerCase();
    return host || fallback;
  } catch {
    return fallback;
  }
}

module.exports = { resolveCanonicalHost, DEFAULT_HOST };
