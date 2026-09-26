'use strict';
/*
 * GET /robots.txt — derived from the product's public surface.
 *
 * public/robots.txt stays as the ENGINE default (what a shell served without
 * this route would get). This route is mounted before the static mount and
 * wins: the fixed lines (auth, api, the admin shell) are the engine's, the
 * Disallow lines for the hidden surfaces come from
 * `identity.surface.hiddenRoutes` (config/publicSurface.js — the same list
 * that noindexes them and keeps them out of the sitemap), per supported
 * locale, and the Sitemap line is APP_URL's. So a downstream never edits the
 * static file to be itself (identity-seam-2, 2026-09-23).
 */
const express = require('express');
const { HIDDEN_PUBLIC_ROUTES, NOINDEX_ROUTES } = require('../config/publicSurface');
const { SUPPORTED_LOCALES } = require('../config/i18n');
const { isIndexableRequest } = require('../utils/indexability');

const APP_URL = (process.env.APP_URL || 'https://www.orangesmiley.is').replace(/\/$/, '');

/** The robots.txt for this product — pure over its inputs, for the tests. */
function buildRobots({ hidden = HIDDEN_PUBLIC_ROUTES, noindex = NOINDEX_ROUTES, locales = SUPPORTED_LOCALES, appUrl = APP_URL } = {}) {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /auth/',
    'Disallow: /api/',
    '# Admin shell (incl. the internal sales handbook). All content behind it is',
    '# auth-gated at the API layer; this just keeps the shell out of crawlers.',
    'Disallow: /admin',
    ...locales.map((lc) => `Disallow: /${lc}/admin`),
  ];
  if (hidden.length) {
    lines.push(
      '',
      '# Hidden-but-functional surfaces (identity.surface.hiddenRoutes). They still',
      '# render for anyone with the URL; they are simply not part of the public',
      '# site. Each also emits <meta name="robots" content="noindex">.',
    );
    for (const route of hidden) for (const lc of locales) lines.push(`Disallow: /${lc}${route}`);
  }
  if (noindex.length) {
    lines.push(
      '',
      "# The product's own noindex routes (identity.routes[*].noindex). Linked,",
      '# served, never indexed; each also emits <meta name="robots" content="noindex">.',
    );
    for (const route of noindex) for (const lc of locales) lines.push(`Disallow: /${lc}${route === '/' ? '/' : route}`);
  }
  lines.push('', `Sitemap: ${appUrl}/sitemap.xml`, '');
  return lines.join('\n');
}

const router = express.Router();

// A non-production instance, or any instance reached on an infrastructure host
// (*.azurewebsites.net, localhost, a bare IP), shuts crawlers out entirely —
// utils/indexability.js, ported from icelandicstore #123 (harvest 2). The same
// rule noindexes every page (ssrMeta) and empties the sitemap.
const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

router.get('/robots.txt', (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  // Short-lived, and keyed on the Host: a production stack answers on BOTH its
  // custom domain and its Azure default hostname, and a shared cache keyed on
  // the path alone could hand the public domain the Disallow meant for the
  // Azure hostname (de-indexing the live site), or the reverse.
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Vary', 'Host');
  res.status(200).send(isIndexableRequest(req) ? buildRobots() : DISALLOW_ALL);
});

module.exports = { router, buildRobots, DISALLOW_ALL };
