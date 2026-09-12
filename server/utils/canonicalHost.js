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
 * UNSET falls back to the base's own host, matching ssrMeta. SET BUT
 * UNPARSABLE throws — "APP_URL=orangesmiley.is" (no scheme) is a one-character
 * mistake that would otherwise silently reproduce the defect this file fixes,
 * with the redirect aimed at another owner's domain. A boot failure with the
 * value in the message is the safer outcome (the same posture as REQUIRED_ENV
 * in server/server.js).
 */
const DEFAULT_HOST = 'www.hallismiley.is';

function resolveCanonicalHost(appUrl, fallback = DEFAULT_HOST) {
  if (appUrl == null || (typeof appUrl === 'string' && appUrl.trim() === '')) return fallback;
  let host = '';
  try { host = new URL(String(appUrl).trim()).host.toLowerCase(); } catch { /* handled below */ }
  if (!host) {
    throw new TypeError(`APP_URL is set but is not an absolute URL with a host: ${JSON.stringify(appUrl)} — expected e.g. https://www.example.is`);
  }
  return host;
}

module.exports = { resolveCanonicalHost, DEFAULT_HOST };
