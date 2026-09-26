'use strict';
/**
 * A non-production instance, or any instance reached on an infrastructure host,
 * is shut to crawlers on all three surfaces at once: robots.txt `Disallow: /`,
 * `<meta name="robots" content="noindex, nofollow">` on every page, and an
 * empty sitemap. Production on the public domain is unchanged. Ported from
 * icelandicstore #123 (robotsTxt.test.js) in harvest 2, 2026-09-26.
 *
 * Every test pins BOTH conditions — APP_ENV and the Host — so a host test
 * cannot pass because of the tier, or the reverse.
 */
const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const { DISALLOW_ALL } = require('../../server/routes/robotsRoutes');
const { EMPTY_SITEMAP } = require('../../server/routes/sitemapRoutes');
const { localePrefix } = require('../lib/locale');

const PUBLIC_HOST = new URL(process.env.APP_URL).host;
const INFRA_HOSTS = [
  ['an Azure default hostname', 'orangesmiley-web.azurewebsites.net'],
  ['localhost', 'localhost:3000'],
  ['a bare IP', '10.0.0.4'],
];

const ORIGINAL = process.env.APP_ENV;
const setAppEnv = (v) => { if (v === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = v; };
afterAll(async () => {
  setAppEnv(ORIGINAL);
  await db.pool.end();
});

const robotsMeta = (html) => (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1];
const HOME = `${localePrefix() || ''}/`;

describe('production on the public domain — unchanged', () => {
  beforeAll(() => setAppEnv('production'));

  test('robots.txt allows crawling and names the sitemap, keyed on Host', async () => {
    const res = await request(app).get('/robots.txt').set('Host', PUBLIC_HOST);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/^Allow: \/$/m);
    expect(res.text).not.toMatch(/^Disallow: \/$/m);
    expect(res.text).toContain(`Sitemap: ${process.env.APP_URL.replace(/\/$/, '')}/sitemap.xml`);
    expect(res.headers.vary).toMatch(/Host/);
  });

  test('the sitemap lists the public surface', async () => {
    const res = await request(app).get('/sitemap.xml').set('Host', PUBLIC_HOST);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<loc>/);
    expect(res.headers.vary).toMatch(/Host/);
  });

  test('the home page is index, follow', async () => {
    const res = await request(app).get(HOME).set('Host', PUBLIC_HOST);
    expect(res.status).toBe(200);
    expect(robotsMeta(res.text)).toBe('index, follow');
    expect(res.headers.vary).toMatch(/Host/);
  });
});

describe.each(INFRA_HOSTS)('production reached on %s', (_label, host) => {
  beforeAll(() => setAppEnv('production'));

  test('robots.txt is Disallow: / with no sitemap', async () => {
    const res = await request(app).get('/robots.txt').set('Host', host);
    expect(res.status).toBe(200);
    expect(res.text).toBe(DISALLOW_ALL);
  });

  test('the sitemap is a valid, empty urlset', async () => {
    const res = await request(app).get('/sitemap.xml').set('Host', host);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.text).toBe(EMPTY_SITEMAP);
    expect(res.text).not.toMatch(/<loc>/);
  });

  test('every page is noindex', async () => {
    const res = await request(app).get(HOME).set('Host', host);
    expect(robotsMeta(res.text)).toBe('noindex, nofollow');
  });
});

describe.each(['test', 'staging'])('APP_ENV=%s on the public domain', (tier) => {
  beforeAll(() => setAppEnv(tier));

  test('robots.txt, the sitemap and the meta tag all shut crawlers out', async () => {
    const robots = await request(app).get('/robots.txt').set('Host', PUBLIC_HOST);
    expect(robots.text).toBe(DISALLOW_ALL);
    const sitemap = await request(app).get('/sitemap.xml').set('Host', PUBLIC_HOST);
    expect(sitemap.text).toBe(EMPTY_SITEMAP);
    const page = await request(app).get(HOME).set('Host', PUBLIC_HOST);
    expect(robotsMeta(page.text)).toBe('noindex, nofollow');
  });
});
