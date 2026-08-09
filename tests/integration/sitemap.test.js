'use strict';

/**
 * Dynamic sitemap.xml — served from server/routes/sitemapRoutes.js.
 *
 * The sitemap advertises the PUBLIC BUSINESS surface only: the six business
 * routes plus project (case-study) detail pages. Hidden-but-functional
 * surfaces listed in server/config/publicSurface.js (party, bio, news, shop,
 * and the superseded /projects · /contact · /privacy aliases) must NOT appear
 * — they still render, but ssrMeta marks them noindex and a sitemap entry
 * would contradict that.
 *
 * Static fixtures are created by tests/globalSetup.js; an empty projects
 * table is fine — the static business entries are always present.
 */
const request = require('supertest');
const app     = require('../../server/app');
const { HIDDEN_PUBLIC_ROUTES } = require('../../server/config/publicSurface');

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

  test('includes both locale variants of every business route', () => {
    for (const path of ['/', '/thjonusta', '/verkefni', '/um-okkur', '/hafa-samband', '/personuvernd', '/terms']) {
      const suffix = path === '/' ? '/' : path;
      expect(res.text).toMatch(new RegExp(`<loc>https?://[^<]+/en${suffix}</loc>`));
      expect(res.text).toMatch(new RegExp(`<loc>https?://[^<]+/is${suffix}</loc>`));
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

  test('each entry has matching hreflang alternates', () => {
    expect(res.text).toMatch(/<xhtml:link rel="alternate" hreflang="en" href="[^"]+\/en\/verkefni"/);
    expect(res.text).toMatch(/<xhtml:link rel="alternate" hreflang="is" href="[^"]+\/is\/verkefni"/);
  });

  test('home gets an x-default hreflang so search engines know the canonical landing', () => {
    expect(res.text).toMatch(/hreflang="x-default"/);
  });

  test('no references to the retired halliprojects.is domain', () => {
    expect(res.text).not.toMatch(/halliprojects\.is/);
  });
});
