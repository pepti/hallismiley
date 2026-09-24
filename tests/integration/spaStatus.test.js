'use strict';

/**
 * HTTP status of the SPA shell (icelandicstore #399, harvest-ice-e-2026-09-24).
 *
 * The catch-all used to answer 200 for every path, so a typo, a retired URL and
 * a deleted article were all "pages" to a crawler or an uptime check (only a
 * switched-off module's routes answered 404, R4). It now answers 404 — still
 * with the shell, so the router renders NotFoundView — for a path no SPA route
 * matches and for a detail slug (article, product, project) with no live row.
 * Every real route must stay 200: this walks the whole shared pattern list
 * (public/js/routePatterns.json) in both locales.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { patterns } = require('../../server/utils/spaRoutes');
const { isDisabledRoute } = require('../../server/config/modules');
const { forcedLocaleFor } = require('../../server/config/i18n');

const SLUG = 'spa-status-live-product';
let projectId;

beforeAll(async () => {
  await db.query('DELETE FROM products WHERE slug = $1', [SLUG]);
  await db.query(
    `INSERT INTO products (slug, name, price_isk, price_eur, stock, active)
     VALUES ($1, 'SPA Status Product', 1000, 700, 5, TRUE)`,
    [SLUG],
  );
  const { rows } = await db.query(
    `INSERT INTO projects (title, description, category, year)
     VALUES ('SPA status project', 'x', 'tech', 2026) RETURNING id`,
  );
  projectId = rows[0].id;
});

afterAll(async () => {
  await db.query('DELETE FROM products WHERE slug = $1', [SLUG]);
  if (projectId) await db.query('DELETE FROM projects WHERE id = $1', [projectId]);
});

function samplePath(pattern) {
  return pattern.split('/').map(seg => {
    if (seg === ':slug') return SLUG;
    if (seg === ':id') return String(projectId);
    return seg.startsWith(':') ? 'abc123' : seg;
  }).join('/');
}

const html = (url) => request(app).get(url).set('Accept', 'text/html');

describe('SPA shell status', () => {
  test.each(['is', 'en'])('every route pattern answers 200 under /%s/', async (locale) => {
    const bad = [];
    for (const p of patterns) {
      if (isDisabledRoute(p)) continue;               // R4: a switched-off module 404s by design
      // Detail routes whose sample id is not a real row are covered below.
      if (p === '/news/:slug' || p === '/admin/books/ar/:customerKey') continue;
      // A locale-locked route (the party pages) is walked under its own locale.
      const lc = forcedLocaleFor(p) || locale;
      const url = `/${lc}${p === '/' ? '/' : samplePath(p)}`;
      const res = await html(url);
      if (res.status !== 200) bad.push(`${url} → ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  test('a trailing slash on a real route is still 200', async () => {
    expect((await html('/is/thjonusta/')).status).toBe(200);
    expect((await html('/en/admin/books/invoices/')).status).toBe(200);
  });

  test('a path no route matches is a 404 that still carries the SPA shell, noindex', async () => {
    for (const url of ['/is/no-such-page', '/en/verkefni/1/extra', '/is/thjonusta/extra']) {
      const res = await html(url);
      expect([url, res.status]).toEqual([url, 404]);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toMatch(/<div id="app"><\/div>/);
      expect(res.text).toMatch(/<meta name="robots" content="noindex/);
    }
  });

  test('a detail slug with no live row is a 404, never cached', async () => {
    for (const url of ['/is/shop/no-such-product-anywhere', '/en/news/no-such-article', '/is/verkefni/999999999']) {
      const res = await html(url);
      expect([url, res.status]).toEqual([url, 404]);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).toMatch(/<div id="app"><\/div>/);
    }
  });

  test('a live detail row is a plain 200, revalidated', async () => {
    const res = await html(`/is/shop/${SLUG}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, no-cache');
  });

  // A pool timeout / failover / warm-up must not turn every live detail page
  // into a 404 (ice review of #399): a FAILED lookup keeps the old answer —
  // 200, never cached — and only a real "no such row" is a 404.
  test('a failed detail lookup answers 200 no-store, not 404', async () => {
    const { lookups } = require('../../server/middleware/ssrMeta');
    const real = lookups.detail;
    lookups.detail = async () => { throw new Error('timeout exceeded when trying to connect'); };
    try {
      const res = await html(`/is/shop/${SLUG}`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).toMatch(/<div id="app"><\/div>/);
    } finally {
      lookups.detail = real;
    }
  });
});

describe('/favicon.ico', () => {
  test('301s to the SVG the site actually ships', async () => {
    const res = await request(app).get('/favicon.ico');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/favicon.svg');
  });

  test('the SVG itself is served', async () => {
    const res = await request(app).get('/favicon.svg');
    expect(res.status).toBe(200);
  });
});
