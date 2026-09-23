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
const { HIDDEN_PUBLIC_ROUTES, PUBLIC_NAV, LEGAL_ROUTES } = require('../../server/config/publicSurface');
const { clientConfig } = require('../../server/config/clientConfig');

const ID = clientConfig.identity;
const locOf = (locale, path) => new RegExp(`<loc>https?://[^<]+/${locale}${path === '/' ? '/' : path}</loc>`);

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

  test('includes both locale variants of home, every nav route and every legal page, in that order', () => {
    const paths = ['/', ...PUBLIC_NAV.map((e) => e.route), ...LEGAL_ROUTES];
    let cursor = 0;
    for (const path of paths) {
      for (const locale of ['en', 'is']) {
        const m = res.text.slice(cursor).match(locOf(locale, path));
        // (a null here means `${locale}${path}` is missing or out of order)
        expect(m && `${locale}${path}`).toBe(`${locale}${path}`);
        cursor += m.index + m[0].length;
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
    const allowed = new Set(['/', ...PUBLIC_NAV.map((e) => e.route), ...LEGAL_ROUTES]);
    const locs = [...res.text.matchAll(/<loc>https?:\/\/[^<]+?\/(en|is)(\/[^<]*)<\/loc>/g)].map((m) => m[2]);
    expect(locs.length).toBeGreaterThan(0);
    expect(locs.filter((p) => !allowed.has(p))).toEqual([]); // anything listed here is advertised by mistake
  });

  test('each entry has matching hreflang alternates', () => {
    const first = PUBLIC_NAV[0] ? PUBLIC_NAV[0].route : LEGAL_ROUTES[0];
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
