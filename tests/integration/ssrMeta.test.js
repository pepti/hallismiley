'use strict';

/**
 * SPA catch-all + SSR meta injection.
 *
 * Covers the P3 SEO work: clean URLs, server-side redirects, per-route
 * locale-aware meta tags (title, description, og:*, canonical, hreflang,
 * <html lang>). We don't assert on the body — that's still client-side —
 * only on what crawlers see in the <head>.
 */
const request = require('supertest');
const app     = require('../../server/app');

describe('SSR meta-injection — SPA catch-all', () => {
  test('GET / redirects to preferred-locale path based on Accept-Language', async () => {
    const res = await request(app)
      .get('/')
      .set('Accept-Language', 'is-IS,is;q=0.9');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/is/');
  });

  test('GET / falls back to en when Accept-Language has no supported match', async () => {
    const res = await request(app)
      .get('/')
      .set('Accept-Language', 'de-DE');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/en/');
  });

  test('preferred_locale cookie beats Accept-Language on root redirect', async () => {
    const res = await request(app)
      .get('/')
      .set('Cookie', 'preferred_locale=is')
      .set('Accept-Language', 'en-US');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/is/');
  });

  test('GET /en/ renders index.html with EN meta tags', async () => {
    const res = await request(app).get('/en/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/<html lang="en"/);
    expect(res.text).toMatch(/<title id="ssr-title">[^<]*(Carpenter|Halli)[^<]*<\/title>/);
    expect(res.text).toMatch(/property="og:locale" content="en_IS"/);
    expect(res.text).toMatch(/rel="canonical" href="[^"]*\/en\/"/);
  });

  test('GET /is/halli renders IS-language meta', async () => {
    const res = await request(app).get('/is/halli');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<html lang="is"/);
    expect(res.text).toMatch(/<title id="ssr-title">[^<]*(Halla|viður)[^<]*<\/title>/);
    expect(res.text).toMatch(/property="og:locale" content="is_IS"/);
    expect(res.text).toMatch(/rel="canonical" href="[^"]*\/is\/halli"/);
  });

  test('hreflang alternates point at both locales + x-default', async () => {
    const res = await request(app).get('/en/projects');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/rel="alternate" hreflang="en" href="[^"]*\/en\/projects"/);
    expect(res.text).toMatch(/rel="alternate" hreflang="is" href="[^"]*\/is\/projects"/);
    expect(res.text).toMatch(/rel="alternate" hreflang="x-default"/);
  });

  test('unknown SPA route still serves the shell with generic meta (404 handled client-side)', async () => {
    const res = await request(app).get('/en/does-not-exist');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<html lang="en"/);
    // Falls back to the home-tier meta — we just need a valid title.
    expect(res.text).toMatch(/<title id="ssr-title">[^<]+<\/title>/);
  });

  test('missed /api/ paths return JSON 404, never HTML', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual(expect.objectContaining({ error: expect.any(String), code: 404 }));
  });

  test('response carries cache headers for CDN/edge caching', async () => {
    const res = await request(app).get('/en/');
    expect(res.headers['cache-control']).toMatch(/public.*max-age=300.*stale-while-revalidate/);
    expect(res.headers['vary']).toMatch(/Accept-Language/);
  });
});
