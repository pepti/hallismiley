'use strict';

// Which paths the SPA can render. The pattern list is shared with the client
// router (public/js/routePatterns.json — tests/unit/routePatterns.test.js keeps
// it identical to router.js ROUTES), so the server can answer an unknown path
// with a real 404 status. The body is still the SPA shell: the router then
// renders NotFoundView exactly as before; only crawlers and monitors see the
// difference, which is the point — a soft 404 (200 + "not found" page) gets
// indexed and hides dead links.

const { patterns } = require('../../public/js/routePatterns.json');

const SPLIT = patterns.map(p => p.split('/'));

/**
 * Does `route` (locale prefix already removed, e.g. '/shop/lopi-hat') match an
 * SPA route pattern? Mirrors router.js matchRoute(): same segment count, literal
 * segments equal, `:param` segments match any single non-empty segment.
 * A trailing slash is ignored (the server strips it before routing meta too).
 */
function matchesSpaRoute(route) {
  const clean = (String(route || '/').replace(/\/+$/, '')) || '/';
  const parts = clean.split('/');
  return SPLIT.some(pp => pp.length === parts.length
    && pp.every((seg, i) => (seg.startsWith(':') ? parts[i] !== '' : seg === parts[i])));
}

module.exports = { matchesSpaRoute, patterns };
