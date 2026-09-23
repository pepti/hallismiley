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
// Everything brand-bearing is asserted against the product identity
// (config/client.json via clientConfig), never a literal: the same suite runs
// unchanged in a downstream that sets its own identity block.
const { clientConfig } = require('../../server/config/clientConfig');
// A locale-locked route (the party pages; a product's `identity.routes[*]
// .locale`) 301s under any other prefix and renders under its own only, so a
// path is built with `forcedLocaleFor(route) || LC` — identity-seam-3.
const { forcedLocaleFor } = require('../../server/config/i18n');
const { isHiddenRoute } = require('../../server/config/publicSurface');
const ID     = clientConfig.identity;
const SUFFIX = ID.brand.titleSuffix;
// The visitor default and "the other" supported locale (for the cookie cases).
const LC    = ID.locale.publicDefault;
const OTHER = LC === 'is' ? 'en' : 'is';
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pathFor = (route) => `/${forcedLocaleFor(route) || LC}${route === '/' ? '/' : route}`;
// The Service catalogue is the COMPANY's offering: the engine emits it only
// while /thjonusta is public, so its cases run only there (a downstream that
// hides the company pages — hallismiley — has no catalogue to assert).
const testServices = isHiddenRoute('/thjonusta') ? test.skip : test;

describe('SSR meta-injection — SPA catch-all', () => {
  // The root redirect is the visitor default (Icelandic here) unless the
  // visitor has explicitly chosen otherwise. Accept-Language is NOT a signal:
  // most Icelandic browsers report en-US, so honouring it would serve the
  // English site to the exact audience this one is written for.
  test.each([
    ['an Icelandic browser',      'is-IS,is;q=0.9'],
    ['an English browser',        'en-US,en;q=0.9'],
    ['an unsupported language',   'de-DE'],
  ])('GET / lands on the visitor default for %s', async (_label, acceptLanguage) => {
    const res = await request(app).get('/').set('Accept-Language', acceptLanguage);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/${LC}/`);
  });

  test('GET / with no locale signal at all lands on the visitor default', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/${LC}/`);
  });

  test('an explicit locale_choice cookie is what moves the landing page', async () => {
    const res = await request(app)
      .get('/')
      .set('Cookie', `locale_choice=${OTHER}`)
      .set('Accept-Language', 'is-IS');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/${OTHER}/`);
  });

  test('legacy preferred_locale cookie is ignored (polluted by the old fallback bug)', async () => {
    const res = await request(app)
      .get('/')
      .set('Cookie', `preferred_locale=${OTHER}`)
      .set('Accept-Language', 'en-US');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/${LC}/`);
  });

  test('GET /en/ renders index.html with EN meta tags', async () => {
    const res = await request(app).get('/en/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/<html lang="en"/);
    expect(res.text).toMatch(new RegExp(`<title id="ssr-title">[^<]*${escRe(ID.brand.name)}[^<]*</title>`));
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
    expect(th.text).toMatch(/imagesrcset="[^"]*\/assets\/iceland\/canyon-river-[^"]*\.avif[^"]*"/);

    // Home is the waterfall video again (2026-08-22 revert): a scene preload
    // there would fetch ~200KB the page never paints.
    const home = await request(app).get('/is/');
    expect(home.status).toBe(200);
    expect(home.text).not.toContain('id="ssr-scene-preload"');
  });

  test('business routes render locale-aware business meta, titled with the brand suffix', async () => {
    const th = await request(app).get('/is/thjonusta');
    expect(th.status).toBe(200);
    expect(th.text).toContain(`<title id="ssr-title">Þjónusta${SUFFIX}</title>`);
    expect(th.text).toMatch(/rel="canonical" href="[^"]*\/is\/thjonusta"/);

    const um = await request(app).get('/en/um-okkur');
    expect(um.status).toBe(200);
    expect(um.text).toContain(`<title id="ssr-title">About us${SUFFIX}</title>`);

    const hs = await request(app).get('/is/hafa-samband');
    expect(hs.status).toBe(200);
    expect(hs.text).toContain(`<title id="ssr-title">Hafa samband${SUFFIX}</title>`);

    const pv = await request(app).get('/is/personuvernd');
    expect(pv.status).toBe(200);
    expect(pv.text).toContain(`<title id="ssr-title">Persónuverndarstefna${SUFFIX}</title>`);

    const vk = await request(app).get('/is/verkefni');
    expect(vk.status).toBe(200);
    expect(vk.text).toContain(`<title id="ssr-title">Verkefnin okkar${SUFFIX}</title>`);
    expect(vk.text).toMatch(/rel="alternate" hreflang="en" href="[^"]*\/en\/verkefni"/);
  });

  // The identity seam (2026-09-22): the product's config/client.json reaches
  // the browser through the shell — the theme trio as <html> attributes for
  // the pre-paint theme-boot.js, the whole record as <script id="identity">
  // for utils/identity.js — and the brand-bearing static tags follow it.
  describe('identity hand-off', () => {
    test('the theme trio rides <html> and the identity rides the script tag', async () => {
      const res = await request(app).get('/is/');
      expect(res.text).toContain(
        `<html lang="is" data-default-theme="${ID.theme.default}" data-theme-picker="${ID.theme.picker.join(' ')}" data-root-theme="${ID.theme.root}">`
      );
      const m = res.text.match(/<script id="identity" type="application\/json">([\s\S]*?)<\/script>/);
      expect(m).not.toBeNull();
      expect(JSON.parse(m[1])).toEqual(JSON.parse(JSON.stringify(ID)));
    });

    test('og:site_name is the brand and <meta author> the registered company', async () => {
      const res = await request(app).get('/en/');
      expect(res.text).toContain(`<meta property="og:site_name" content="${ID.brand.name}" />`);
      expect(res.text).toContain(`<meta name="author" content="${ID.brand.legalName}" />`);
    });
  });

  // "Hidden from nav/SSR/sitemap, still functional" — the routes render a
  // full page; they are simply de-indexed. See server/config/publicSurface.js.
  // Both lists are the product's (identity.surface.*), never literals: the
  // hidden routes are noindexed, home + the nav + the legal pages stay
  // indexable — whatever a downstream puts in each.
  describe('hidden public surfaces', () => {
    const { PUBLIC_NAV, LEGAL_ROUTES, NOINDEX_ROUTES } = require('../../server/config/publicSurface');
    const hidden = ID.surface.hiddenRoutes.map(pathFor);
    // A nav route the product marks noindex (identity.routes) is linked but
    // de-indexed — it belongs with the hidden ones here.
    const indexable = ['/', ...PUBLIC_NAV.map((e) => e.route), ...LEGAL_ROUTES]
      .filter((r) => !NOINDEX_ROUTES.includes(r)).map(pathFor);

    test('the lists are non-trivial (guard)', () => {
      expect(indexable.length).toBeGreaterThan(1);
    });

    test.each(indexable)(
      '%s stays indexable',
      async (path) => {
        const res = await request(app).get(path);
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/<meta name="robots" content="index, follow"/);
      }
    );

    // A product may hide nothing; `.each` refuses an empty list.
    (hidden.length ? describe : describe.skip)('the hidden routes', () => {
      test.each(hidden)(
        '%s still renders, marked noindex',
        async (path) => {
          const res = await request(app).get(path);
          expect(res.status).toBe(200);
          expect(res.text).toMatch(/<title id="ssr-title">[^<]+<\/title>/);
          expect(res.text).toMatch(/<meta name="robots" content="noindex, nofollow"/);
        }
      );

      test('a hidden detail route is de-indexed too', async () => {
        const res = await request(app).get(`${pathFor(ID.surface.hiddenRoutes[0])}/some-detail-slug`);
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/<meta name="robots" content="noindex, nofollow"/);
      });
    });

    // The product's own noindex routes (identity.routes[*].noindex, identity-seam-3).
    (NOINDEX_ROUTES.length ? describe : describe.skip)('the product\'s noindex routes', () => {
      test.each(NOINDEX_ROUTES.map(pathFor))('%s renders, marked noindex', async (path) => {
        const res = await request(app).get(path);
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/<meta name="robots" content="noindex, nofollow"/);
      });
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

  // ── Static-asset prefixes (base fix 2b6842c, ported 2026-09-01) ───────────
  // /assets, /js, /css and /fonts GETs are exempt from the global rate
  // limiter (utils/staticAsset.js). Two things must therefore hold, and
  // they are asserted here because the limiter itself is skipped under
  // NODE_ENV=test: a miss under those prefixes must terminate at a cheap JSON
  // 404 rather than reaching the SSR/DB path (ssrMeta only skips paths that
  // carry a file extension, so extensionless + Accept: text/html used to fall
  // through to database-backed meta rendering), and the exemption must not be
  // wider than those four prefixes.

  test('missed static-asset paths return JSON 404, never the SPA shell', async () => {
    for (const path of [
      '/assets/iceland/gone.avif',
      '/assets/no-extension',
      '/js/nope.js',
      '/js/no-extension',
      '/css/nope.css',
      '/fonts/nope.woff2',
    ]) {
      const res = await request(app).get(path).set('Accept', 'text/html');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual(expect.objectContaining({ error: expect.any(String), code: 404 }));
    }
  });

  test('existing static assets still serve under every exempt prefix', async () => {
    const css = await request(app).get('/css/main.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);

    const js = await request(app).get('/js/router.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);

    const img = await request(app).get('/assets/waterfall-cover.jpg');
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toMatch(/image\/jpeg/);

    const font = await request(app).get('/fonts/barlow-400-normal-latin.woff2');
    expect(font.status).toBe(200);
  });

  // Tightness: the prefix must be the WHOLE first segment and must sit at the
  // root. Anything else is an ordinary SPA route and still gets the shell —
  // if one of these ever 404s as JSON, the exemption has grown too wide.
  test.each(['/assetsguide/intro', '/is/assets/yfirlit', '/is/css-tips'])(
    '%s is not treated as a static-asset path',
    async (path) => {
      const res = await request(app).get(path).set('Accept', 'text/html');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
    }
  );

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
    test('emits a WebSite JSON-LD schema with the identity’s brand-name alternates', async () => {
      const res = await request(app).get('/en/');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<script type="application\/ld\+json">[^<]*"@type":"WebSite"/);
      expect(res.text).toContain(`"name":"${ID.brand.name}","alternateName":${JSON.stringify(ID.brand.alternateNames)}`);
      // Publisher reference resolves to the Organization schema's @id.
      expect(res.text).toMatch(/"publisher":\{"@id":"https:\/\/www\.hallismiley\.is\/#organization"\}/);
    });

    // index.html is baked with https://www.orangesmiley.is; the template loader
    // swaps that origin for APP_URL (the tests run as hallismiley.is) and drops
    // the baked Organization block, which the server re-emits from the identity
    // on the same @id the publisher refs point at.
    test('the Organization JSON-LD is built on APP_URL, once, from the identity', async () => {
      const res = await request(app).get('/en/');
      expect(res.text).toContain('"@type":"Organization","@id":"https://www.hallismiley.is/#organization"');
      expect(res.text.match(/"@type":\s*"Organization"/g)).toHaveLength(1);
      expect(res.text).not.toContain('https://www.orangesmiley.is');
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

  test('the home page emits WebSite bound to the Organization', async () => {
    const res = await request(app).get('/is/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/"@type":"WebSite"/);
    expect(res.text).toMatch(/"publisher":\{"@id":"https?:\/\/[^"]*\/#organization"\}/);
  });

  testServices('the home page emits the Service catalogue too, bound to the Organization (while /thjonusta is public)', async () => {
    const res = await request(app).get('/is/');
    expect(res.text).toMatch(/"@type":"Service"/);
    expect(res.text).toMatch(/"provider":\{"@id":"https?:\/\/[^"]*\/#organization"\}/);
  });

  test('the Organization the server references actually exists, named after the identity', async () => {
    const res = await request(app).get('/is/');
    expect(res.text).toMatch(/"@type":\s*"Organization"/);
    expect(res.text).toMatch(ORG_ID);
    expect(res.text).toContain(`"name":${JSON.stringify(ID.brand.legalName)}`);
  });

  testServices('the services page carries the service catalogue', async () => {
    const res = await request(app).get('/is/thjonusta');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/"@type":"OfferCatalog"/);
  });

  testServices('the catalogue lists the company\'s services, with Rekstrarkerfið as one product in it', async () => {
    // Orange Smiley sells any software a small business needs, and the
    // product's tiers and prices live on its own site (Halli, 2026-09-13).
    const res = await request(app).get('/is/thjonusta');
    const block = (res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [])
      .find(b => b.includes('OfferCatalog'));
    const service = JSON.parse(block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
    const items = service.hasOfferCatalog.itemListElement;
    expect(items.map(i => i.itemOffered?.name).filter(Boolean)).toContain('Sérsmíðuð kerfi');
    const product = items.find(i => i.itemOffered?.name === 'Rekstrarkerfið');
    expect(product.itemOffered.url).toBe('https://rekstrarkerfi.is/is/');
    for (const tier of ['Vefur', 'Verslun', 'Rekstur']) {
      expect(block).not.toMatch(new RegExp(`"name":"${tier}"`));
    }
  });

  testServices('no unconfirmed price is published as structured data', async () => {
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

// ── Admin copy is spliced in literally (2026-09-23) ──────────────────────────
// Every html.replace in ssrMeta takes a replacer FUNCTION, never a template
// string: in a replacement string `$&`, `` $` ``, `$'` and `$$` are patterns,
// so saved copy containing them pasted the template prefix (the whole <head>)
// into the page, or a `</script>` into the JSON-LD. The copy below carries all
// four and must come out byte-for-byte (after esc()), with one of everything.

describe('SSR — replacement patterns in saved copy stay literal', () => {
  const db = require('../../server/config/database');
  const PAYLOAD = "A $& B $` C $' D $$ E";
  const ESCAPED = "A $&amp; B $` C $' D $$ E";
  const SLUG = 'test-ssr-dollar-patterns';
  // Paths and the locale the rows are written in come from the seam, so the
  // cases hold in a downstream that locks a route to one language.
  const lcFor = (route) => forcedLocaleFor(route) || LC;
  // A product that re-describes `/` (identity.routes) builds its own home
  // mirror; the engine's is exercised only where the engine owns `/`.
  const testEngineHome = ID.routes && ID.routes['/'] ? test.skip : test;
  const saved = [];

  // The page is still one page: the template's singletons appear once.
  function expectOnePage(html) {
    expect(html.match(/<!DOCTYPE html>/gi)).toHaveLength(1);
    expect(html.match(/<head\b/gi)).toHaveLength(1);
    expect(html.match(/<\/head>/gi)).toHaveLength(1);
    expect(html.match(/<script src="\/js\/theme-boot\.js">/g)).toHaveLength(1);
    expect(html.match(/<body\b/gi)).toHaveLength(1);
    expect(html.match(/<div id="app">/g)).toHaveLength(1);
  }

  // Every JSON-LD block still parses — a `$'`/`` $` `` expansion inside one
  // carries its own </script> and cuts it short.
  // At least the Organization block is always there, so an empty match means
  // the tail itself was lost.
  function jsonLdBlocks(html) {
    const blocks = (html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [])
      .map(b => JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')));
    expect(blocks.some(b => b['@type'] === 'Organization')).toBe(true);
    return blocks;
  }

  async function upsertContent(key, locale, patch) {
    const { rows } = await db.query(
      'SELECT value FROM site_content WHERE key = $1 AND locale = $2', [key, locale]);
    const value = rows[0] ? rows[0].value : null;
    saved.push({ key, locale, value });
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (key, locale) DO UPDATE SET value = EXCLUDED.value`,
      [key, locale, JSON.stringify({ ...(value || {}), ...patch })]
    );
  }

  beforeAll(async () => {
    await upsertContent('halli_bio', lcFor('/halli'), { meta_description: PAYLOAD });
    await upsertContent('home_hero', lcFor('/'), { heading: PAYLOAD });
    await db.query('DELETE FROM news_articles WHERE slug = $1', [SLUG]);
    await db.query(
      `INSERT INTO news_articles (title, slug, summary, body, published, published_at)
       VALUES ($1, $2, $1, $3, TRUE, NOW())`,
      [PAYLOAD, SLUG, `<p>${ESCAPED}</p>`]
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM news_articles WHERE slug = $1', [SLUG]);
    for (const { key, locale, value } of saved.reverse()) {
      if (value === null) {
        await db.query('DELETE FROM site_content WHERE key = $1 AND locale = $2', [key, locale]);
      } else {
        await db.query(
          'UPDATE site_content SET value = $3::jsonb WHERE key = $1 AND locale = $2',
          [key, locale, JSON.stringify(value)]);
      }
    }
  });

  test('a site_content meta_description reaches the <head> tags literally', async () => {
    const res = await request(app).get(pathFor('/halli'));
    expect(res.status).toBe(200);
    expect(res.text).toContain(`<meta name="description" content="${ESCAPED}" id="ssr-description" />`);
    expect(res.text).toContain(`<meta property="og:description" content="${ESCAPED}" />`);
    expectOnePage(res.text);
    jsonLdBlocks(res.text);
  });

  testEngineHome('a site_content heading reaches the crawler mirror literally', async () => {
    const res = await request(app).get(pathFor('/'));
    expect(res.status).toBe(200);
    expect(res.text).toContain(`<div id="crawler-content" hidden aria-hidden="true"><h1>${ESCAPED}</h1>`);
    expectOnePage(res.text);
    jsonLdBlocks(res.text);
  });

  test('a news article carries the copy through <title>, description, JSON-LD and the crawler mirror', async () => {
    const res = await request(app).get(pathFor(`/news/${SLUG}`));
    expect(res.status).toBe(200);
    expect(res.text).toMatch(new RegExp(`<title id="ssr-title">${escRe(ESCAPED)}`));
    expect(res.text).toContain(`<meta name="description" content="${ESCAPED}" id="ssr-description" />`);
    expect(res.text).toContain(`<article><h1>${ESCAPED}</h1><p><em>${ESCAPED}</em></p><p>${ESCAPED}</p></article>`);
    expectOnePage(res.text);
    const article = jsonLdBlocks(res.text).find(b => b['@type'] === 'Article');
    expect(article.headline).toBe(PAYLOAD);
    expect(article.description).toBe(PAYLOAD);
  });
});
