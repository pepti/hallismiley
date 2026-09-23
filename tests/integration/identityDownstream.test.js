'use strict';

/**
 * What a DOWNSTREAM product needs from the identity seam, end to end: with its
 * own `identity` block in config/client.json — and nothing else changed — the
 * SSR'd page presents as that product. This is the case the hallismiley graft
 * hit (its HISTORY `engine-graft`): merged as-is, Halli's personal site would
 * have presented as the company site because the engine pinned Orange Smiley
 * literals in tests and files. Its second sync (PR pepti/hallismiley#168)
 * then listed what the seam still lacked — the public nav, the sitemap, the
 * page parts, the manifest, the products card — and identity-seam-2
 * (2026-09-23) closed those; this suite is that list as assertions, with
 * hallismiley's real identity block.
 *
 * The app is required fresh inside jest.isolateModules with CLIENT_CONFIG_FILE
 * pointing at a temp file, so the singleton config, every reader of it
 * (publicSurface, themes, i18n, ssrMeta, the sitemap, the manifest) and the
 * Express app resolve to the downstream identity. Same worker database as
 * every other suite; only GET requests are made.
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const request = require('supertest');

// hallismiley's block (engine-sync/2026-09-23), plus the nav this iteration adds.
const DOWNSTREAM = {
  brand: {
    name: 'Halli Smiley',
    legalName: 'Halli Smiley',
    alternateNames: ['Hallismiley', 'Halli', 'halli smiley'],
    titleSuffix: ' — Halli Smiley',
  },
  locale: { publicDefault: 'en' },
  theme: { default: 'classic', root: 'classic', picker: ['classic', 'glacier', 'moss', 'lava', 'aurora', 'black-sand'] },
  hero: { clip: '/assets/videos/waterfall-bk-v1.mp4', poster: '/assets/videos/waterfall-bk-v1-poster.jpg' },
  surface: {
    nav: [
      { route: '/verkefni', labelKey: 'nav.projects' },
      { route: '/news',     labelKey: 'nav.news' },
      { route: '/halli',    labelKey: 'nav.halli' },
    ],
    hiddenRoutes: ['/thjonusta', '/um-okkur', '/hafa-samband'],
    hiddenAdminViews: [],
  },
  organization: {
    email: 'halli@hallismiley.is',
    description: 'Icelandic craftsman who moves between wood and software.',
    addressLocality: 'Hafnarfjörður',
    sameAs: ['https://github.com/pepti'],
  },
};

const script = (html) => {
  const m = html.match(/<script id="identity" type="application\/json">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
};
// hallismiley (engine-sync-2): the served title is HTML-escaped ("&" in the base's home part).
const title = (html) => ((html.match(/<title id="ssr-title">([^<]*)<\/title>/) || [])[1] || '').replace(/&amp;/g, '&');
const robots = (html) => (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1];

describe('a downstream identity flows through the served page', () => {
  let dir;
  let app;
  const savedFile = process.env.CLIENT_CONFIG_FILE;
  const savedLocale = process.env.PUBLIC_DEFAULT_LOCALE;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-downstream-'));
    fs.writeFileSync(path.join(dir, 'client.json'), JSON.stringify({ identity: DOWNSTREAM }));
    process.env.CLIENT_CONFIG_FILE = path.join(dir, 'client.json');
    delete process.env.PUBLIC_DEFAULT_LOCALE;
    jest.isolateModules(() => {
      const { problems } = require('../../server/config/clientConfig');
      expect(problems).toEqual([]);
      app = require('../../server/app');
    });
  });

  afterAll(() => {
    if (savedFile === undefined) delete process.env.CLIENT_CONFIG_FILE;
    else process.env.CLIENT_CONFIG_FILE = savedFile;
    if (savedLocale !== undefined) process.env.PUBLIC_DEFAULT_LOCALE = savedLocale;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the landing redirect follows the downstream visitor default', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/en/');
  });

  test('titles carry the downstream suffix and brand, composed from the i18n page parts', async () => {
    // The page parts are the ENGINE's i18n text until the product overlays
    // `meta.<key>.title` in product.<locale>.json — so "Our work" and the
    // engine home part appear, with the downstream brand and suffix.
    const vk = await request(app).get('/en/verkefni');
    expect(vk.status).toBe(200);
    expect(title(vk.text)).toBe('Our work — Halli Smiley');
    expect(vk.text).not.toContain('Orange Smiley');

    // The home part is whatever the server table (engine + this repo's
    // overlay) carries for `meta.home.title`, with the downstream brand in
    // the `{brand}` slot — never the engine's wording as a literal.
    const homePart = require('../../server/i18n').t('en', 'meta.home.title').split('{brand}').join('Halli Smiley');
    expect(homePart).toContain('Halli Smiley');
    const home = await request(app).get('/en/');
    expect(title(home.text)).toBe(homePart);
    expect(home.text).toMatch(/<meta property="og:site_name" content="Halli Smiley" \/>/);
    expect(home.text).toMatch(/<meta name="author" content="Halli Smiley" \/>/);

    // The hidden company page still renders, titled by the same rule, noindexed.
    const th = await request(app).get('/en/thjonusta');
    expect(title(th.text)).toBe('Services — Halli Smiley');
    expect(robots(th.text)).toBe('noindex, nofollow');
  });

  test('the {legalName} in a meta description is the downstream’s registered name', async () => {
    const um = await request(app).get('/en/um-okkur');
    expect(um.text).toMatch(/<meta name="description" content="Halli Smiley is an Icelandic software company/);
    expect(um.text).not.toContain('{legalName}');
  });

  test('the theme trio rides <html> and the whole identity — nav included — rides the script tag', async () => {
    const res = await request(app).get('/en/');
    expect(res.text).toMatch(/<html lang="en" data-default-theme="classic" data-theme-picker="classic glacier moss lava aurora black-sand" data-root-theme="classic">/);
    const id = script(res.text);
    expect(id.brand.name).toBe('Halli Smiley');
    expect(id.hero.clip).toBe('/assets/videos/waterfall-bk-v1.mp4');
    expect(id.surface.hiddenAdminViews).toEqual([]);
    expect(id.theme.picker).toEqual(DOWNSTREAM.theme.picker);
    // What the NavBar, both footers and HomeView read: its own nav, and the
    // company's services page hidden — so the products card does not render
    // (HomeView._products keys off isHiddenRoute('/thjonusta')).
    expect(id.surface.nav).toEqual(DOWNSTREAM.surface.nav);
    expect(id.surface.hiddenRoutes).toContain('/thjonusta');
  });

  test('the sitemap is the downstream nav + home + the legal pages, and none of the company pages', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    const locs = [...res.text.matchAll(/<loc>https:\/\/www\.hallismiley\.is\/(en|is)(\/[^<]*)<\/loc>/g)].map((m) => m[2]);
    expect(locs.filter((p) => p === '/')).toHaveLength(2);
    for (const p of ['/verkefni', '/news', '/halli', '/personuvernd', '/terms']) {
      expect(locs.filter((x) => x === p)).toHaveLength(2);
    }
    for (const p of ['/thjonusta', '/um-okkur', '/hafa-samband']) {
      expect(locs).not.toContain(p);
    }
    expect(new Set(locs)).toEqual(new Set(['/', '/verkefni', '/news', '/halli', '/personuvernd', '/terms']));
    // Order: home, nav in nav order, legal.
    expect(locs.filter((p, i) => i % 2 === 0)).toEqual(['/', '/verkefni', '/news', '/halli', '/personuvernd', '/terms']);
  });

  test('the manifest is named after the downstream', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/manifest\+json/);
    expect(res.body.name).toBe('Halli Smiley');
    expect(res.body.short_name).toBe('Halli Smiley');
    // hallismiley (engine-sync-2): the engine table plus this repo's overlay.
    expect(res.body.description).toBe({ ...require('../../server/i18n/en.json'), ...require('../../server/i18n/product.en.json') }['meta.home.description']);
    expect(res.body.start_url).toBe('/');
    expect(Array.isArray(res.body.icons)).toBe(true);
    // The static engine default still exists for a shell served without SSR.
    expect(JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/manifest.json'), 'utf8')).name).toBeDefined();
  });

  test('the Organization and WebSite JSON-LD are the downstream’s, on the same @id', async () => {
    const res = await request(app).get('/en/');
    const blocks = (res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [])
      .map((b) => JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')));
    const org = blocks.find((b) => b['@type'] === 'Organization');
    const site = blocks.find((b) => b['@type'] === 'WebSite');
    expect(org).toMatchObject({
      '@id': 'https://www.hallismiley.is/#organization',
      name: 'Halli Smiley',
      alternateName: ['Hallismiley', 'Halli', 'halli smiley'],
      email: 'halli@hallismiley.is',
      sameAs: ['https://github.com/pepti'],
    });
    expect(org.description).toBe(DOWNSTREAM.organization.description);
    expect(site).toMatchObject({ name: 'Halli Smiley', publisher: { '@id': 'https://www.hallismiley.is/#organization' } });
    expect(blocks.filter((b) => b['@type'] === 'Organization')).toHaveLength(1); // the baked copy is gone
    // No engine brand anywhere in the structured data. (The crawler body may
    // still carry it: the seeded home copy is company CONTENT, which a product
    // replaces in its own migrations, not identity.)
    expect(JSON.stringify(blocks)).not.toContain('Orange Smiley');
  });

  test('the nav routes are indexable and the company pages are not', async () => {
    for (const p of ['/en/verkefni', '/en/news', '/en/halli']) {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(robots(res.text)).toBe('index, follow');
    }
    for (const p of ['/en/thjonusta', '/en/um-okkur', '/en/hafa-samband']) {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(robots(res.text)).toBe('noindex, nofollow');
    }
  });

  test('the theme validator accepts the downstream set', async () => {
    let THEMES;
    jest.isolateModules(() => { ({ THEMES } = require('../../server/config/themes')); });
    expect(THEMES).toEqual(DOWNSTREAM.theme.picker);
  });
});
