'use strict';

/**
 * Dynamic sitemap.xml — served from server/routes/sitemapRoutes.js.
 * Covers the static list pages plus live news/product/project rows.
 * Static fixtures are created by tests/globalSetup.js; empty
 * news/products/projects tables are fine — the static page entries
 * are always present.
 */
const request = require('supertest');
const app     = require('../../server/app');

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

  test('includes both locale variants of the static list pages', () => {
    // Home + 7 other static routes × 2 locales = 16 static entries minimum.
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]+\/en\/<\/loc>/);
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]+\/is\/<\/loc>/);
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]+\/en\/projects<\/loc>/);
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]+\/is\/projects<\/loc>/);
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]+\/en\/news<\/loc>/);
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]+\/en\/shop<\/loc>/);
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]+\/en\/contact<\/loc>/);
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]+\/en\/halli<\/loc>/);
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]+\/en\/privacy<\/loc>/);
    expect(res.text).toMatch(/<loc>https?:\/\/[^<]+\/en\/terms<\/loc>/);
  });

  test('each entry has matching hreflang alternates', () => {
    expect(res.text).toMatch(/<xhtml:link rel="alternate" hreflang="en" href="[^"]+\/en\/projects"/);
    expect(res.text).toMatch(/<xhtml:link rel="alternate" hreflang="is" href="[^"]+\/is\/projects"/);
  });

  test('home gets an x-default hreflang so search engines know the canonical landing', () => {
    expect(res.text).toMatch(/hreflang="x-default"/);
  });

  test('no references to the retired halliprojects.is domain', () => {
    expect(res.text).not.toMatch(/halliprojects\.is/);
  });
});
