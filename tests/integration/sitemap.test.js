'use strict';

/**
 * Dynamic sitemap.xml — served from server/routes/sitemapRoutes.js.
 *
 * The sitemap advertises the PUBLIC surface only: home, the product's nav
 * routes (identity.surface.nav) and the engine's legal pages, each minus the
 * product's hidden routes — the same lists config/publicSurface.js derives
 * for the nav and the footers. Hidden-but-functional surfaces must NOT
 * appear: they still render, but ssrMeta marks them noindex and a sitemap
 * entry would contradict that. Every expectation reads the resolved seam
 * (identity-seam-2, 2026-09-23), never a route literal, so the suite passes
 * unchanged in a downstream with its own nav.
 *
 * Static fixtures are created by tests/globalSetup.js; an empty projects
 * table is fine — the static entries are always present.
 */
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { lastmodKeys, invalidateLastmodCache } = require('../../server/routes/sitemapRoutes');
const { HIDDEN_PUBLIC_ROUTES, NOINDEX_ROUTES, PUBLIC_NAV, LEGAL_ROUTES } = require('../../server/config/publicSurface');
const { clientConfig } = require('../../server/config/clientConfig');
// A locale-locked route (the party pages; `identity.routes[*].locale`) is
// listed under its own locale only, with no alternates — identity-seam-3.
const { forcedLocaleFor } = require('../../server/config/i18n');

const ID = clientConfig.identity;
const locOf = (locale, path) => new RegExp(`<loc>https?://[^<]+/${locale}${path === '/' ? '/' : path}</loc>`);
const localesOf = (path) => (forcedLocaleFor(path) ? [forcedLocaleFor(path)] : ['en', 'is']);
// The advertised list: home, nav, legal — minus the product's noindex routes.
const ADVERTISED = ['/', ...PUBLIC_NAV.map((e) => e.route), ...LEGAL_ROUTES].filter((p) => !NOINDEX_ROUTES.includes(p));

describe('GET /sitemap.xml', () => {
  let res;

  beforeAll(async () => {
    res = await request(app).get('/sitemap.xml');
  });

  test('returns 200 with XML content-type', () => {
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
  });

  test('sets CDN-friendly cache headers', () => {
    expect(res.headers['cache-control']).toMatch(/public.*max-age=600.*stale-while-revalidate/);
  });

  test('declares the sitemap XML namespace and xhtml namespace for hreflang', () => {
    expect(res.text).toMatch(/<urlset[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
    expect(res.text).toMatch(/xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  });

  test('the public surface is home + the nav routes + the legal pages, minus the hidden routes (guard)', () => {
    // The lists this suite walks come from the seam; make sure they are what
    // config/client.json says, so a wrong derivation cannot pass vacuously.
    const hidden = (r) => ID.surface.hiddenRoutes.some((h) => r === h || r.startsWith(h + '/'));
    expect(PUBLIC_NAV).toEqual(ID.surface.nav.filter((e) => !hidden(e.route)));
    expect(LEGAL_ROUTES).toEqual(['/personuvernd', '/terms'].filter((r) => !hidden(r)));
    expect(HIDDEN_PUBLIC_ROUTES).toEqual(ID.surface.hiddenRoutes);
  });

  test('includes both locale variants of home, every nav route and every legal page, in that order (a locked route once)', () => {
    let cursor = 0;
    for (const path of ADVERTISED) {
      for (const locale of localesOf(path)) {
        const m = res.text.slice(cursor).match(locOf(locale, path));
        // (a null here means `${locale}${path}` is missing or out of order)
        expect(m && `${locale}${path}`).toBe(`${locale}${path}`);
        cursor += m.index + m[0].length;
      }
    }
  });

  test('a locale-locked route is listed under its locale only, with no alternates', () => {
    for (const path of ADVERTISED) {
      const forced = forcedLocaleFor(path);
      if (!forced) continue;
      const other = forced === 'is' ? 'en' : 'is';
      expect(res.text).not.toMatch(locOf(other, path));
      const entry = res.text.slice(res.text.search(locOf(forced, path)));
      expect(entry.slice(0, entry.indexOf('</url>'))).not.toMatch(/hreflang=/);
    }
  });

  test('a noindex product route (identity.routes) is never advertised', () => {
    for (const base of NOINDEX_ROUTES) {
      for (const locale of ['en', 'is']) {
        expect(res.text).not.toMatch(new RegExp(`<loc>https?://[^<]+/${locale}${base === '/' ? '/' : base}</loc>`));
      }
    }
  });

  // The contract of "hidden from nav/SSR/sitemap but still functional": the
  // routes work (see the party/news/shop API + view suites), they just are
  // not advertised here.
  test('advertises no hidden public surface', () => {
    for (const base of HIDDEN_PUBLIC_ROUTES) {
      for (const locale of ['en', 'is']) {
        expect(res.text).not.toMatch(new RegExp(`<loc>https?://[^<]+/${locale}${base}(/[^<]*)?</loc>`));
      }
    }
  });

  test('advertises nothing outside that list', () => {
    const allowed = new Set(ADVERTISED);
    const locs = [...res.text.matchAll(/<loc>https?:\/\/[^<]+?\/(en|is)(\/[^<]*)<\/loc>/g)].map((m) => m[2]);
    expect(locs.length).toBeGreaterThan(0);
    expect(locs.filter((p) => !allowed.has(p))).toEqual([]); // anything listed here is advertised by mistake
  });

  test('each entry has matching hreflang alternates', () => {
    // The first advertised route that is not locale-locked (a locked one has none).
    const first = ADVERTISED.find((p) => p !== '/' && !forcedLocaleFor(p));
    expect(first).toBeDefined();
    expect(res.text).toMatch(new RegExp(`<xhtml:link rel="alternate" hreflang="en" href="[^"]+/en${first}"`));
    expect(res.text).toMatch(new RegExp(`<xhtml:link rel="alternate" hreflang="is" href="[^"]+/is${first}"`));
  });

  test('home gets an x-default hreflang so search engines know the canonical landing', () => {
    expect(res.text).toMatch(/hreflang="x-default"/);
  });

  test('no references to the retired halliprojects.is domain', () => {
    expect(res.text).not.toMatch(/halliprojects\.is/);
  });
});

// <lastmod> = the newest site_content row a page renders (rk-feed, 2026-09-23):
// engine routes from ssrMeta.contentKeysForRoute, product routes from
// identity.routes[*].contentKeys. A route with no rows carries none.
describe('GET /sitemap.xml — <lastmod>', () => {
  const entryOf = (text, locale, path) => {
    const at = text.search(locOf(locale, path));
    if (at < 0) return null;
    const tail = text.slice(at);
    return tail.slice(0, tail.indexOf('</url>'));
  };
  // The first advertised route that has content keys, under a locale it is listed in.
  const keyed = Object.entries(lastmodKeys()).find(([p]) => ADVERTISED.includes(p || '/'));
  const unkeyed = ADVERTISED.find((p) => !(Object.prototype.hasOwnProperty.call(lastmodKeys(), p === '/' ? '' : p)));

  afterAll(() => invalidateLastmodCache());

  test('the routes with content keys are advertised routes and the keys look like site_content keys (guard)', () => {
    for (const [p, keys] of Object.entries(lastmodKeys())) {
      expect(ADVERTISED).toContain(p || '/');
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) expect(k).toMatch(/^[a-z0-9_]+$/);
    }
  });

  test('follows the last save of a row the page renders, and is absent where no row backs the page', async () => {
    if (!keyed) return; // a product that advertises no content-backed route
    const [path, keys] = keyed;
    const route = path || '/';
    const locale = forcedLocaleFor(route) || 'is';
    // Make one of the page's rows the newest thing in the table.
    const { rows } = await db.query('SELECT key, locale FROM site_content WHERE key = ANY($1) LIMIT 1', [keys]);
    if (!rows[0]) {
      await db.query(`INSERT INTO site_content (key, locale, value) VALUES ($1, 'is', '{}'::jsonb)
                      ON CONFLICT (key, locale) DO NOTHING`, [keys[0]]);
    }
    await db.query('UPDATE site_content SET updated_at = NOW() WHERE key = ANY($1)', [keys]);
    invalidateLastmodCache();
    const fresh = await request(app).get('/sitemap.xml');
    const today = new Date().toISOString().slice(0, 10);
    expect(entryOf(fresh.text, locale, route)).toContain(`<lastmod>${today}</lastmod>`);
    if (unkeyed) {
      const lc = forcedLocaleFor(unkeyed) || 'is';
      expect(entryOf(fresh.text, lc, unkeyed)).not.toMatch(/<lastmod>/);
    }
  });

  test('the value is a date, never a timestamp, and the result is cached for the response window', async () => {
    if (!keyed) return;
    const [path] = keyed;
    const route = path || '/';
    const locale = forcedLocaleFor(route) || 'is';
    invalidateLastmodCache();
    const a = await request(app).get('/sitemap.xml');
    expect(entryOf(a.text, locale, route)).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    // A newer save does not show until the cache is dropped.
    await db.query('UPDATE site_content SET updated_at = NOW() - interval \'400 days\' WHERE key = ANY($1)', [keyed[1]]);
    const b = await request(app).get('/sitemap.xml');
    expect(entryOf(b.text, locale, route)).toBe(entryOf(a.text, locale, route));
    invalidateLastmodCache();
    const c = await request(app).get('/sitemap.xml');
    expect(entryOf(c.text, locale, route)).not.toBe(entryOf(a.text, locale, route));
    await db.query('UPDATE site_content SET updated_at = NOW() WHERE key = ANY($1)', [keyed[1]]);
  });
});
