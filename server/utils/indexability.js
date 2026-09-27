'use strict';
/*
 * Who may be indexed by search engines. Ported from icelandicstore #123
 * (server/utils/indexability.js) in harvest 2, 2026-09-26.
 *
 * Only the production tier, served on a real public domain, may be crawled.
 * Everything else answers robots.txt `Disallow: /`, a `noindex` robots meta tag
 * and an EMPTY sitemap:
 *
 *   - a TEST / staging stack (APP_ENV set to anything but `production`) — ice's
 *     TEST carries a weekly clone of production data, and an indexed TEST is a
 *     duplicate site competing with the real one;
 *   - any stack reached on its Azure default hostname (`*.azurewebsites.net`) —
 *     once the custom domain is bound, an indexed default hostname is a
 *     duplicate of the real site;
 *   - localhost and bare IP literals (probes, direct-to-container access, a
 *     laptop instance such as the private books instance).
 *
 * The rule is derived from the REQUEST HOST, not from APP_URL: a stack's
 * APP_URL is often pointed at its Azure hostname before cutover, so gating on
 * it would leave the stack indexable. "Not an infrastructure hostname" is
 * correct before the custom domain is bound and the moment it is — no env var
 * to remember on cutover day.
 *
 * APP_ENV only, not the appEnv() fallback to NODE_ENV: a deployed container
 * bakes NODE_ENV=production, and a run without APP_ENV is judged by its host
 * alone (the test suites pin the Host they mean).
 */

// Hostnames that are infrastructure, never the public site.
function isPublicHost(hostHeader) {
  const raw = String(hostHeader || '').toLowerCase().trim();
  if (!raw) return false;
  // Bare IPv6 literal, bracketed or not ([::1]:3000, ::1).
  if (raw.startsWith('[') || (raw.match(/:/g) || []).length > 1) return false;
  const host = raw.split(':')[0];
  if (!host) return false;
  if (host.endsWith('.azurewebsites.net')) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  // Bare IPv4 literal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return true;
}

// True only for the production tier served on a real public domain.
function isIndexableRequest(req) {
  const tier = String(process.env.APP_ENV || 'production').trim().toLowerCase();
  if (tier !== 'production') return false;
  return isPublicHost(req && req.headers && req.headers.host);
}

module.exports = { isPublicHost, isIndexableRequest };
