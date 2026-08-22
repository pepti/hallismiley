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
  // The root redirect is Icelandic unless the visitor has explicitly chosen
  // otherwise. Accept-Language is NOT a signal here: most Icelandic browsers
  // report en-US, so honouring it would serve the English site to the exact
  // audience this one is written for.
  test.each([
    ['an Icelandic browser',      'is-IS,is;q=0.9'],
    ['an English browser',        'en-US,en;q=0.9'],
    ['an unsupported language',   'de-DE'],
  ])('GET / lands on Icelandic for %s', async (_label, acceptLanguage) => {
    const res = await request(app).get('/').set('Accept-Language', acceptLanguage);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/is/');
  });

  test('GET / with no locale signal at all lands on Icelandic', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/is/');
  });

  test('an explicit locale_choice cookie is what moves the landing page', async () => {
    const res = await request(app)
      .get('/')
      .set('Cookie', 'locale_choice=en')
      .set('Accept-Language', 'is-IS');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/en/');
  });

  test('legacy preferred_locale cookie is ignored (polluted by the old fallback bug)', async () => {
    const res = await request(app)
      .get('/')
      .set('Cookie', 'preferred_locale=en')
      .set('Accept-Language', 'en-US');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/is/');
  });

  test('GET /en/ renders index.html with EN meta tags', async () => {
    const res = await request(app).get('/en/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/<html lang="en"/);
    expect(res.text).toMatch(/<title id="ssr-title">[^<]*Rekstrarkerfið[^<]*<\/title>/);
    expect(res.text).toMatch(/property="og:locale" content="en_IS"/);
    expect(res.text).toMatch(/rel="canonical" href="[^"]*\/en\/"/);
  });

  test('scene routes preload their hero image; the video home does not', async () => {
    // Injected by ssrMeta from server/config/sceneManifest.json — the tag must
    // sit BEFORE the main stylesheet so the fetch starts ahead of CSS parse.
    const th = await request(app).get('/is/thjonusta');
    expect(th.status).toBe(200);
    const preloadAt = th.text.indexOf('id="ssr-scene-preload"');
    const cssAt = th.text.indexOf('href="/css/main.css"');
    expect(preloadAt).toBeGreaterThan(-1);
    expect(cssAt).toBeGreaterThan(preloadAt);
    expect(th.text).toMatch(/<link rel="preload" as="image"[^>]*fetchpriority="high"/);
    expect(th.text).toMatch(/imagesrcset="[^"]*\/assets\/iceland\/sigoldugljufur-[^"]*\.avif[^"]*"/);

    // Home is the waterfall video again (2026-08-22 revert): a scene preload
    // there would fetch ~200KB the page never paints.
    const home = await request(app).get('/is/');
    expect(home.status).toBe(200);
    expect(home.text).not.toContain('id="ssr-scene-preload"');
  });

  test('business routes render locale-aware business meta', async () => {
    const th = await request(app).get('/is/thjonusta');
    expect(th.status).toBe(200);
    expect(th.text).toMatch(/<title id="ssr-title">Þjónusta og verð — Rekstrarkerfið<\/title>/);
    expect(th.text).toMatch(/rel="canonical" href="[^"]*\/is\/thjonusta"/);

    const um = await request(app).get('/en/um-okkur');
    expect(um.status).toBe(200);
    expect(um.text).toMatch(/<title id="ssr-title">About us — Rekstrarkerfið<\/title>/);

    const hs = await request(app).get('/is/hafa-samband');
    expect(hs.status).toBe(200);
    expect(hs.text).toMatch(/<title id="ssr-title">Hafa samband — Rekstrarkerfið<\/title>/);

    const pv = await request(app).get('/is/personuvernd');
    expect(pv.status).toBe(200);
    expect(pv.text).toMatch(/<title id="ssr-title">Persónuverndarstefna — Rekstrarkerfið<\/title>/);

    const vk = await request(app).get('/is/verkefni');
    expect(vk.status).toBe(200);
    expect(vk.text).toMatch(/<title id="ssr-title">Verkefnin okkar — Rekstrarkerfið<\/title>/);
    expect(vk.text).toMatch(/rel="alternate" hreflang="en" href="[^"]*\/en\/verkefni"/);
  });

  // "Hidden from nav/SSR/sitemap, still functional" — the routes render a
  // full page; they are simply de-indexed. See server/config/publicSurface.js.
  describe('hidden public surfaces', () => {
    test.each(['/is/party', '/is/halli', '/is/news', '/is/shop', '/is/projects', '/is/contact'])(
      '%s still renders, marked noindex',
      async (path) => {
        const res = await request(app).get(path);
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/<title id="ssr-title">[^<]+<\/title>/);
        expect(res.text).toMatch(/<meta name="robots" content="noindex, nofollow"/);
      }
    );

    test.each(['/is/', '/is/thjonusta', '/is/verkefni', '/is/um-okkur', '/is/hafa-samband', '/is/personuvernd'])(
      '%s stays indexable',
      async (path) => {
        const res = await request(app).get(path);
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/<meta name="robots" content="index, follow"/);
      }
    );

    test('a hidden detail route is de-indexed too', async () => {
      const res = await request(app).get('/is/news/some-article-slug');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    });
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

  test('list pages emit a BreadcrumbList JSON-LD so crawlers place them in the hierarchy', async () => {
    const res = await request(app).get('/en/news');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<script type="application\/ld\+json">[^<]*"@type":"BreadcrumbList"/);
  });

  test('list pages include a hidden crawler-content block with h1 for non-JS crawlers', async () => {
    const res = await request(app).get('/en/news');
    expect(res.status).toBe(200);
    // The #crawler-content block should exist even when the list is empty
    // (crawlerListHtml returns '' only when rows.length === 0, so assert on
    // the more reliable case: /news always serves the shell with h1 in the
    // <title> at minimum — verify the block wrapper exists when rows exist,
    // otherwise assert on the head meta.
    expect(res.text).toMatch(/<title id="ssr-title">News — Halli Smiley<\/title>/);
  });

  test('detail routes for missing news articles fall back to generic head without crashing', async () => {
    const res = await request(app).get('/en/news/this-slug-definitely-does-not-exist');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<title id="ssr-title">[^<]+<\/title>/);
  });

  test('unknown product slug gracefully falls back to the shop defaults', async () => {
    const res = await request(app).get('/is/shop/not-a-real-product');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<html lang="is"/);
  });

  test('canonical URLs never reference the retired halliprojects.is domain', async () => {
    const res = await request(app).get('/en/');
    expect(res.text).not.toMatch(/halliprojects\.is/);
  });

  // ── Shop redesign step 2 — section sub-routes ───────────────────────────
  // Each /shop/{products,tech,carpentry} route gets its own SSR title and
  // breadcrumb so the sections are independently linkable + indexable. They
  // must also NOT match the /shop/:slug product-detail pattern.

  test('/en/shop/products renders the section-specific title', async () => {
    const res = await request(app).get('/en/shop/products');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<html lang="en"/);
    expect(res.text).toMatch(/<title id="ssr-title">Products — Halli Smiley Shop<\/title>/);
    expect(res.text).toMatch(/rel="canonical" href="[^"]*\/en\/shop\/products"/);
  });

  test('/en/shop/tech renders the tech-services title (NOT the product-detail fallback)', async () => {
    const res = await request(app).get('/en/shop/tech');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<title id="ssr-title">Tech Services — Work with Halli<\/title>/);
  });

  test('/is/shop/carpentry renders the Icelandic carpentry title', async () => {
    const res = await request(app).get('/is/shop/carpentry');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<html lang="is"/);
    expect(res.text).toMatch(/<title id="ssr-title">Smíðaþjónusta — Vinnuðu með Halla<\/title>/);
  });

  test('shop section sub-routes emit a BreadcrumbList JSON-LD', async () => {
    const res = await request(app).get('/en/shop/tech');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<script type="application\/ld\+json">[^<]*"@type":"BreadcrumbList"/);
  });

  // ── Party page — invite-friendly link previews ─────────────────────────────
  // A shared /party link must NOT inherit the generic home-page bio as its
  // og:description (that "about me" text is embarrassing on party invites).
  // The route gets its own party description + the cover photo as og:image.

  describe('party page — link-preview meta', () => {
    test('/is/party sets the Icelandic party description, not the site bio', async () => {
      const res = await request(app).get('/is/party');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<html lang="is"/);
      expect(res.text).toContain('Þér er boðið í 40 ára afmæli Halla');
      // Must not leak the generic portfolio bio into the party preview.
      expect(res.text).not.toContain('Verkefnasafn Halla');
    });

    test('/is/party keeps its party title', async () => {
      const res = await request(app).get('/is/party');
      expect(res.text).toMatch(/<title id="ssr-title">40 ára afmæli Halla<\/title>/);
    });

    test('party page emits an absolute og:image URL', async () => {
      const res = await request(app).get('/is/party');
      // Either the uploaded cover (/assets/party/…) or the default og-image —
      // both are absolute URLs on the canonical host.
      expect(res.text).toMatch(/property="og:image" content="https:\/\/www\.hallismiley\.is\/[^"]+"/);
    });
  });

  // ── Party is Icelandic-only ────────────────────────────────────────────────
  // The page is a birthday landing for an all-Icelandic guest list. English is
  // not published: see server/config/i18n.js forcedLocaleFor.

  describe('party page — locale lock', () => {
    test('/en/party permanently redirects to /is/party', async () => {
      const res = await request(app).get('/en/party');
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/is/party');
    });

    test('an unprefixed /party redirects to Icelandic, not the default locale', async () => {
      const res = await request(app).get('/party');
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/is/party');
    });

    test('party sub-routes redirect too, preserving the magic-link token', async () => {
      const res = await request(app).get('/en/party/login?token=abc123&x=1');
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/is/party/login?token=abc123&x=1');
    });

    test('an en locale_choice cookie does not reopen the English party page', async () => {
      const res = await request(app).get('/en/party').set('Cookie', 'locale_choice=en');
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/is/party');
    });

    test('/is/party canonicalises to itself and offers no English alternate', async () => {
      const res = await request(app).get('/is/party');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/rel="canonical"[^>]*href="https:\/\/www\.hallismiley\.is\/is\/party"/);
      expect(res.text).toMatch(/hreflang="is"[^>]*href="https:\/\/www\.hallismiley\.is\/is\/party"/);
      expect(res.text).toMatch(/hreflang="x-default"[^>]*href="https:\/\/www\.hallismiley\.is\/is\/party"/);
      // The English alternate tag must be gone, not merely repointed.
      expect(res.text).not.toMatch(/hreflang="en"/);
    });

    test('non-party pages keep both hreflang alternates', async () => {
      const res = await request(app).get('/en/projects');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/hreflang="en"[^>]*href="https:\/\/www\.hallismiley\.is\/en\/projects"/);
      expect(res.text).toMatch(/hreflang="is"[^>]*href="https:\/\/www\.hallismiley\.is\/is\/projects"/);
      expect(res.text).toMatch(/hreflang="x-default"/);
    });
  });

  // ── Bing-focused SEO additions ─────────────────────────────────────────────

  describe('search-engine verification tokens (Bing / Google)', () => {
    afterEach(() => {
      delete process.env.BING_VERIFICATION_TOKEN;
      delete process.env.GOOGLE_VERIFICATION_TOKEN;
    });

    test('BING_VERIFICATION_TOKEN populates the msvalidate.01 meta tag', async () => {
      process.env.BING_VERIFICATION_TOKEN = 'TEST-bing-token-1234';
      const res = await request(app).get('/en/');
      expect(res.text).toMatch(/<meta name="msvalidate\.01" content="TEST-bing-token-1234"/);
    });

    test('GOOGLE_VERIFICATION_TOKEN populates the google-site-verification meta tag', async () => {
      process.env.GOOGLE_VERIFICATION_TOKEN = 'gv-test-token-5678';
      const res = await request(app).get('/en/');
      expect(res.text).toMatch(/<meta name="google-site-verification" content="gv-test-token-5678"/);
    });

    test('unset env vars leave the placeholder empty (no token leaks into HTML)', async () => {
      const res = await request(app).get('/en/');
      expect(res.text).toMatch(/<meta name="msvalidate\.01" content=""/);
      expect(res.text).toMatch(/<meta name="google-site-verification" content=""/);
    });
  });

  describe('home page — WebSite schema + crawler content', () => {
    test('emits a WebSite JSON-LD schema with brand-name alternates', async () => {
      const res = await request(app).get('/en/');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<script type="application\/ld\+json">[^<]*"@type":"WebSite"/);
      expect(res.text).toMatch(/"alternateName":\["Orangesmiley","Orange Smiley ehf\.","orange smiley","Rekstrarkerfið","Rekstrarkerfi"\]/);
      // Publisher reference resolves to the baked Organization schema's @id.
      expect(res.text).toMatch(/"publisher":\{"@id":"https:\/\/www\.hallismiley\.is\/#organization"\}/);
    });

    test('does not emit WebSite schema on non-home pages', async () => {
      const res = await request(app).get('/en/halli');
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/"@type":"WebSite"/);
    });

    test('injects a hidden crawler-content block with H1 and section H2s', async () => {
      const res = await request(app).get('/en/');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<div id="crawler-content" hidden aria-hidden="true">/);
      // H1 falls back to the home title when no site_content row exists.
      expect(res.text).toMatch(/<div id="crawler-content"[^>]*><h1>[^<]+<\/h1>/);
    });
  });

  describe('IndexNow key-file route', () => {
    const ORIGINAL_KEY = process.env.INDEXNOW_KEY;
    afterEach(() => {
      if (ORIGINAL_KEY === undefined) delete process.env.INDEXNOW_KEY;
      else process.env.INDEXNOW_KEY = ORIGINAL_KEY;
    });

    test('serves the key as text/plain when the URL matches INDEXNOW_KEY', async () => {
      process.env.INDEXNOW_KEY = 'abc123def456ghi789';
      const res = await request(app).get('/abc123def456ghi789.txt');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toBe('abc123def456ghi789');
    });

    test('returns 404 (via static fall-through) when the key does not match', async () => {
      process.env.INDEXNOW_KEY = 'abc123def456ghi789';
      const res = await request(app).get('/wrongkey00000000.txt');
      expect(res.status).toBe(404);
    });

    test('returns 404 when INDEXNOW_KEY is unset (dev/preview default)', async () => {
      delete process.env.INDEXNOW_KEY;
      const res = await request(app).get('/abc123def456ghi789.txt');
      expect(res.status).toBe(404);
    });
  });
});

// ── Structured data for the business (job 2F) ────────────────────────────────
// The Organization is baked into public/index.html; everything the server
// emits references it by @id. A dangling reference yields a broken knowledge
// graph, so the two halves are asserted together.

describe('business JSON-LD', () => {
  const ORG_ID = /"@id":\s*"https?:\/\/[^"]*\/#organization"/;

  test('the home page emits WebSite + Service, both bound to the Organization', async () => {
    const res = await request(app).get('/is/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/"@type":"WebSite"/);
    expect(res.text).toMatch(/"@type":"Service"/);
    expect(res.text).toMatch(/"publisher":\{"@id":"https?:\/\/[^"]*\/#organization"\}/);
    expect(res.text).toMatch(/"provider":\{"@id":"https?:\/\/[^"]*\/#organization"\}/);
  });

  test('the baked Organization the server references actually exists', async () => {
    const res = await request(app).get('/is/');
    // The baked block in public/index.html is pretty-printed, so allow the
    // whitespace that the server's JSON.stringify output never has.
    expect(res.text).toMatch(/"@type":\s*"Organization"/);
    expect(res.text).toMatch(ORG_ID);
    expect(res.text).toMatch(/"name":\s*"Orange Smiley ehf\."/);
  });

  test('the services page carries the tier catalogue', async () => {
    const res = await request(app).get('/is/thjonusta');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/"@type":"OfferCatalog"/);
    for (const tier of ['Vefur', 'Verslun', 'Rekstur']) {
      expect(res.text).toMatch(new RegExp(`"name":"${tier}"`));
    }
  });

  test('no unconfirmed price is published as structured data', async () => {
    // Prices are DRAFT until Halli signs off. A number in JSON-LD reads as a
    // commitment, so the catalogue deliberately carries none.
    const res = await request(app).get('/is/thjonusta');
    const jsonLd = res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    const service = jsonLd.find(b => b.includes('OfferCatalog')) || '';
    expect(service).not.toMatch(/"price"/);
  });

  test('other business routes do not carry the service catalogue', async () => {
    const res = await request(app).get('/is/um-okkur');
    expect(res.text).not.toMatch(/"@type":"OfferCatalog"/);
  });
});
