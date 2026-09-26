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
 * hallismiley's real identity block. Its third sync (#168, sync 3) and
 * LedgerLink's (orange-smiley/ledgerlink#11) asked for a product slot for a
 * product's OWN routes — `identity.routes` (identity-seam-3) — which the
 * second describe below walks with a LedgerLink-style `/console` (noindex,
 * bare) and a hallismiley-style `/aron13ara` (locale-locked).
 *
 * Nothing here is a literal of the engine's text: expected titles are
 * composed from the SAME i18n table + overlay the server reads (captured
 * fresh inside jest.isolateModules, so `{siteName}` etc. resolve to the
 * downstream), and compared HTML-escaped, as <title> carries them (the base's
 * home part has an "&").
 *
 * The app is required fresh inside jest.isolateModules with CLIENT_CONFIG_FILE
 * pointing at a temp file, so the singleton config, every reader of it
 * (publicSurface, themes, i18n, ssrMeta, the sitemap, the manifest, robots)
 * and the Express app resolve to the downstream identity. Same worker
 * database as every other suite; only GET requests are made.
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const request = require('supertest');
// The public host (APP_URL's, pinned in tests/env.js): indexability is gated on
// the request Host (server/utils/indexability.js) and supertest sends 127.0.0.1.
const PUBLIC_HOST = new URL(process.env.APP_URL).host;
const { composeTitle } = require('../../server/config/identity');

// The product overlay a downstream would commit (server/i18n/product.<lc>.json):
// the keys the `routes` block below names, and a per-locale Organization
// description. Mocked on disk-level so the engine's committed overlays stay
// empty; both apps in this file see it (the first names none of these keys).
const OVERLAY = {
  en: {
    'meta.landing.title': '{brand} — The invoice is already there.',
    'meta.landing.description': 'Self-service document exchange for Icelandic bookkeeping.',
    'meta.console.title': 'Console & ledger — LedgerLink',
    'meta.original.title': 'Original',
    'meta.aron13.title': 'Aron 13 ára',
    'org.description': 'Self-service document exchange (en).',
  },
  is: {
    'meta.landing.title': '{brand} — Reikningurinn er þegar kominn.',
    'meta.landing.description': 'Sjálfsafgreiðsla skjalaskipta fyrir íslenskt bókhald.',
    'meta.console.title': 'Stjórnborð & bók — LedgerLink',
    'meta.original.title': 'Frumrit',
    'meta.aron13.title': 'Aron 13 ára',
    'org.description': 'Sjálfsafgreiðsla skjalaskipta (is).',
  },
};
jest.mock('../../server/i18n/product.en.json', () => OVERLAY.en);
jest.mock('../../server/i18n/product.is.json', () => OVERLAY.is);

// hallismiley's block (engine-sync/2026-09-23, sync 3): its nav includes the
// locale-locked /party, which the sitemap lists under `is` only.
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
      { route: '/party',    labelKey: 'nav.party' },
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

// A product with its own routes (identity-seam-3): LedgerLink's landing,
// console and original page, plus hallismiley's Icelandic-only /aron13ara,
// and a per-locale Organization description through the overlay.
const ROUTED = {
  brand: { name: 'LedgerLink', legalName: 'LedgerLink ehf.', alternateNames: ['Ledger Link'], titleSuffix: ' — LedgerLink' },
  locale: { publicDefault: 'is' },
  surface: {
    nav: [
      { route: '/console',   labelKey: 'nav.projects' },
      { route: '/aron13ara', labelKey: 'nav.halli' },
      { route: '/verkefni',  labelKey: 'nav.projects' },
    ],
    hiddenRoutes: ['/thjonusta', '/um-okkur', '/hafa-samband', '/news', '/shop', '/party'],
  },
  routes: {
    '/':          { titleKey: 'meta.landing.title', descriptionKey: 'meta.landing.description' },
    '/console':   { titleKey: 'meta.console.title', titleMode: 'bare', noindex: true },
    '/original':  { titleKey: 'meta.original.title', noindex: true },
    '/aron13ara': { titleKey: 'meta.aron13.title', titleMode: 'bare', locale: 'is' },
  },
  organization: { email: 'info@ledgerlink.is', description: 'org.description', ogImage: '/og-ledgerlink.jpg' },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const script = (html) => {
  const m = html.match(/<script id="identity" type="application\/json">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
};
const title = (html) => (html.match(/<title id="ssr-title">([^<]*)<\/title>/) || [])[1];
const robots = (html) => (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1];
const description = (html) => (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
const jsonLd = (html) => (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [])
  .map((b) => JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')));

/** Boot a fresh app over a temp client.json carrying `identity`. Returns the
 *  app, the resolved identity and the server t() that reads the overlay —
 *  all from the isolated registry, so they agree with what the app serves. */
function bootWith(identity, dir) {
  fs.writeFileSync(path.join(dir, 'client.json'), JSON.stringify({ identity }));
  process.env.CLIENT_CONFIG_FILE = path.join(dir, 'client.json');
  delete process.env.PUBLIC_DEFAULT_LOCALE;
  let out;
  jest.isolateModules(() => {
    const { problems, clientConfig } = require('../../server/config/clientConfig');
    expect(problems).toEqual([]);
    out = { app: require('../../server/app'), id: clientConfig.identity, t: require('../../server/i18n').t };
  });
  return out;
}

describe('a downstream identity flows through the served page', () => {
  let dir;
  let app;
  let id;
  let tDown;
  const savedFile = process.env.CLIENT_CONFIG_FILE;
  const savedLocale = process.env.PUBLIC_DEFAULT_LOCALE;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-downstream-'));
    ({ app, id, t: tDown } = bootWith(DOWNSTREAM, dir));
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
    // The page parts are the table's — engine text until the product
    // overlays `meta.<key>.title` in product.<locale>.json — composed with the
    // downstream brand and suffix exactly as ssrMeta composes them, and
    // compared HTML-escaped, as <title> carries them. Never a literal.
    const vk = await request(app).get('/en/verkefni');
    expect(vk.status).toBe(200);
    expect(title(vk.text)).toBe(esc(composeTitle(tDown('en', 'meta.projects.title'), undefined, id)));
    expect(vk.text).not.toContain('Orange Smiley');

    const home = await request(app).get('/en/');
    expect(title(home.text)).toBe(esc(composeTitle(tDown('en', 'meta.home.title'), undefined, id)));
    expect(title(home.text)).toContain('Halli Smiley');
    expect(title(home.text)).not.toContain('{brand}');
    expect(home.text).toMatch(/<meta property="og:site_name" content="Halli Smiley" \/>/);
    expect(home.text).toMatch(/<meta name="author" content="Halli Smiley" \/>/);

    // The hidden company page still renders, titled by the same rule, noindexed.
    const th = await request(app).get('/en/thjonusta');
    expect(title(th.text)).toBe(esc(composeTitle(tDown('en', 'meta.thjonusta.title'), undefined, id)));
    expect(title(th.text)).toMatch(/ — Halli Smiley$/);
    expect(robots(th.text)).toBe('noindex, nofollow');
  });

  test('the {legalName} in a meta description is the downstream’s registered name', async () => {
    const um = await request(app).get('/en/um-okkur');
    expect(description(um.text)).toBe(esc(tDown('en', 'meta.umOkkur.description')));
    expect(um.text).toMatch(/<meta name="description" content="Halli Smiley is an Icelandic software company/);
    expect(um.text).not.toContain('{legalName}');
  });

  test('the theme trio rides <html> and the whole identity — nav included — rides the script tag', async () => {
    const res = await request(app).get('/en/');
    expect(res.text).toMatch(/<html lang="en" data-default-theme="classic" data-theme-picker="classic glacier moss lava aurora black-sand" data-root-theme="classic">/);
    const served = script(res.text);
    expect(served.brand.name).toBe('Halli Smiley');
    expect(served.hero.clip).toBe('/assets/videos/waterfall-bk-v1.mp4');
    expect(served.surface.hiddenAdminViews).toEqual([]);
    expect(served.theme.picker).toEqual(DOWNSTREAM.theme.picker);
    // What the NavBar, both footers and HomeView read: its own nav, and the
    // company's services page hidden — so the products card does not render
    // (HomeView._products keys off isHiddenRoute('/thjonusta')).
    expect(served.surface.nav).toEqual(DOWNSTREAM.surface.nav);
    expect(served.surface.hiddenRoutes).toContain('/thjonusta');
    expect(served.routes).toEqual({});
  });

  test('the sitemap is the downstream nav + home + the legal pages, the locked /party once, and none of the company pages', async () => {
    const res = await request(app).get('/sitemap.xml').set('Host', PUBLIC_HOST);
    expect(res.status).toBe(200);
    const locs = [...res.text.matchAll(/<loc>https:\/\/www\.hallismiley\.is\/(en|is)(\/[^<]*)<\/loc>/g)].map((m) => [m[1], m[2]]);
    const paths = locs.map(([, p]) => p);
    expect(paths.filter((p) => p === '/')).toHaveLength(2);
    for (const p of ['/verkefni', '/news', '/halli', '/personuvernd', '/terms']) {
      expect(paths.filter((x) => x === p)).toHaveLength(2);
    }
    // The engine's party lock: listed under `is` only, no alternates.
    expect(locs.filter(([, p]) => p === '/party')).toEqual([['is', '/party']]);
    for (const p of ['/thjonusta', '/um-okkur', '/hafa-samband']) {
      expect(paths).not.toContain(p);
    }
    expect(new Set(paths)).toEqual(new Set(['/', '/verkefni', '/news', '/halli', '/party', '/personuvernd', '/terms']));
    // Order: home, nav in nav order, legal.
    expect([...new Set(paths)]).toEqual(['/', '/verkefni', '/news', '/halli', '/party', '/personuvernd', '/terms']);
  });

  test('the manifest is named after the downstream, described through the overlay', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/manifest\+json/);
    expect(res.body.name).toBe('Halli Smiley');
    expect(res.body.short_name).toBe('Halli Smiley');
    // The visitor-default locale's home description, engine table + product
    // overlay, with `{siteName}`-style params resolved to the downstream.
    expect(res.body.description).toBe(tDown('en', 'meta.home.description'));
    expect(res.body.start_url).toBe('/');
    expect(Array.isArray(res.body.icons)).toBe(true);
    // The static engine default still exists for a shell served without SSR.
    expect(JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/manifest.json'), 'utf8')).name).toBeDefined();
  });

  test('the Organization and WebSite JSON-LD are the downstream’s, on the same @id', async () => {
    const res = await request(app).get('/en/');
    const blocks = jsonLd(res.text);
    const org = blocks.find((b) => b['@type'] === 'Organization');
    const site = blocks.find((b) => b['@type'] === 'WebSite');
    expect(org).toMatchObject({
      '@id': 'https://www.hallismiley.is/#organization',
      name: 'Halli Smiley',
      alternateName: ['Hallismiley', 'Halli', 'halli smiley'],
      email: 'halli@hallismiley.is',
      sameAs: ['https://github.com/pepti'],
    });
    expect(org.description).toBe(DOWNSTREAM.organization.description); // a literal, as written
    expect(site).toMatchObject({ name: 'Halli Smiley', publisher: { '@id': 'https://www.hallismiley.is/#organization' } });
    expect(blocks.filter((b) => b['@type'] === 'Organization')).toHaveLength(1); // the baked copy is gone
    // No engine brand anywhere in the structured data. (The crawler body may
    // still carry it: the seeded home copy is company CONTENT, which a product
    // replaces in its own migrations, not identity.)
    expect(JSON.stringify(blocks)).not.toContain('Orange Smiley');
    // No Service catalogue: the company pages are hidden here.
    expect(blocks.find((b) => b['@type'] === 'Service')).toBeUndefined();
  });

  test('the nav routes are indexable and the company pages are not', async () => {
    for (const p of ['/en/verkefni', '/en/news', '/en/halli']) {
      const res = await request(app).get(p).set('Host', PUBLIC_HOST);
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

describe('identity.routes — a product’s own routes flow through the served page (identity-seam-3)', () => {
  let dir;
  let app;
  let id;
  let tDown;
  const savedFile = process.env.CLIENT_CONFIG_FILE;
  const savedLocale = process.env.PUBLIC_DEFAULT_LOCALE;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-routes-'));
    ({ app, id, t: tDown } = bootWith(ROUTED, dir));
  });

  afterAll(() => {
    if (savedFile === undefined) delete process.env.CLIENT_CONFIG_FILE;
    else process.env.CLIENT_CONFIG_FILE = savedFile;
    if (savedLocale !== undefined) process.env.PUBLIC_DEFAULT_LOCALE = savedLocale;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the overlay is what the app reads (guard)', () => {
    expect(tDown('is', 'meta.console.title')).toBe(OVERLAY.is['meta.console.title']);
    expect(tDown('en', 'org.description')).toBe(OVERLAY.en['org.description']);
  });

  test('a re-described landing: title from the product’s key with {brand}, description from its key, in both locales', async () => {
    for (const lc of ['is', 'en']) {
      const res = await request(app).get(`/${lc}/`).set('Host', PUBLIC_HOST);
      expect(res.status).toBe(200);
      expect(title(res.text)).toBe(esc(composeTitle(tDown(lc, 'meta.landing.title'), undefined, id)));
      expect(title(res.text)).toMatch(/^LedgerLink — /);
      expect(description(res.text)).toBe(esc(tDown(lc, 'meta.landing.description')));
      expect(robots(res.text)).toBe('index, follow');
      // The home page is still the home page: WebSite schema, no catalogue.
      const blocks = jsonLd(res.text);
      expect(blocks.find((b) => b['@type'] === 'WebSite')).toBeDefined();
      expect(blocks.find((b) => b['@type'] === 'Service')).toBeUndefined();
    }
  });

  test('a bare noindex route (/console): the title as written, HTML-escaped, and de-indexed', async () => {
    const res = await request(app).get('/is/console');
    expect(res.status).toBe(200);
    expect(title(res.text)).toBe(esc(OVERLAY.is['meta.console.title']));
    expect(title(res.text)).toContain('&amp;');
    expect(title(res.text)).not.toMatch(/ — LedgerLink — /); // bare: no suffix appended
    expect(robots(res.text)).toBe('noindex, nofollow');
    expect(res.text).toMatch(/rel="canonical" href="[^"]*\/is\/console"/);
    // No description key → the engine home description is NOT borrowed; the
    // description falls back like any static page without one.
    expect(description(res.text)).toBeDefined();
  });

  test('a suffixed noindex route (/original): part + the product suffix', async () => {
    const res = await request(app).get('/en/original');
    expect(res.status).toBe(200);
    expect(title(res.text)).toBe(esc(`${OVERLAY.en['meta.original.title']} — LedgerLink`));
    expect(robots(res.text)).toBe('noindex, nofollow');
  });

  test('a locale-locked route (/aron13ara): 301 under any other prefix, one canonical, no alternates', async () => {
    const en = await request(app).get('/en/aron13ara');
    expect(en.status).toBe(301);
    expect(en.headers.location).toBe('/is/aron13ara');
    const bare = await request(app).get('/aron13ara?x=1');
    expect(bare.status).toBe(301);
    expect(bare.headers.location).toBe('/is/aron13ara?x=1');
    const sub = await request(app).get('/en/aron13ara/craft');
    expect(sub.status).toBe(301);
    expect(sub.headers.location).toBe('/is/aron13ara/craft');
    const cookie = await request(app).get('/en/aron13ara').set('Cookie', 'locale_choice=en');
    expect(cookie.status).toBe(301);

    const is = await request(app).get('/is/aron13ara').set('Host', PUBLIC_HOST);
    expect(is.status).toBe(200);
    expect(is.text).toMatch(/<html lang="is"/);
    expect(title(is.text)).toBe(esc(OVERLAY.is['meta.aron13.title']));
    expect(robots(is.text)).toBe('index, follow');
    expect(is.text).toMatch(/rel="canonical"[^>]*href="https:\/\/www\.hallismiley\.is\/is\/aron13ara"/);
    expect(is.text).toMatch(/hreflang="x-default"[^>]*href="https:\/\/www\.hallismiley\.is\/is\/aron13ara"/);
    expect(is.text).not.toMatch(/hreflang="en"/);
  });

  test('the sitemap lists the locked route under its locale only and never the noindex one', async () => {
    const res = await request(app).get('/sitemap.xml').set('Host', PUBLIC_HOST);
    const locs = [...res.text.matchAll(/<loc>https:\/\/www\.hallismiley\.is\/(en|is)(\/[^<]*)<\/loc>/g)].map((m) => [m[1], m[2]]);
    const paths = locs.map(([, p]) => p);
    expect(paths.filter((p) => p === '/')).toHaveLength(2);
    expect(paths.filter((p) => p === '/verkefni')).toHaveLength(2);
    expect(locs.filter(([, p]) => p === '/aron13ara')).toEqual([['is', '/aron13ara']]);
    expect(paths).not.toContain('/console');
    expect(paths).not.toContain('/original');
    expect([...new Set(paths)]).toEqual(['/', '/aron13ara', '/verkefni', '/personuvernd', '/terms']);
    // The locked entry carries no hreflang alternates.
    const entry = res.text.slice(res.text.indexOf('/is/aron13ara</loc>'));
    expect(entry.slice(0, entry.indexOf('</url>'))).not.toMatch(/hreflang=/);
  });

  test('robots.txt disallows the noindex routes per locale, next to the hidden ones', async () => {
    const res = await request(app).get('/robots.txt').set('Host', PUBLIC_HOST);
    expect(res.status).toBe(200);
    for (const lc of ['en', 'is']) {
      expect(res.text).toContain(`Disallow: /${lc}/console`);
      expect(res.text).toContain(`Disallow: /${lc}/original`);
      expect(res.text).toContain(`Disallow: /${lc}/thjonusta`);
      expect(res.text).not.toContain(`Disallow: /${lc}/aron13ara`);
    }
    expect(res.text).toContain('Sitemap: https://www.hallismiley.is/sitemap.xml');
  });

  test('the manifest description follows the re-described landing', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.body.name).toBe('LedgerLink');
    expect(res.body.description).toBe(tDown('is', 'meta.landing.description'));
  });

  test('the Organization description is per locale through the overlay, and og:image is the product’s card', async () => {
    for (const lc of ['is', 'en']) {
      const res = await request(app).get(`/${lc}/verkefni`);
      const org = jsonLd(res.text).find((b) => b['@type'] === 'Organization');
      expect(org.description).toBe(OVERLAY[lc]['org.description']);
      expect(org.email).toBe('info@ledgerlink.is');
      expect(res.text).toMatch(/property="og:image" content="https:\/\/www\.hallismiley\.is\/og-ledgerlink\.jpg"/);
    }
  });

  test('the routes ride the hand-off, normalised as the client reads them', async () => {
    const res = await request(app).get('/is/verkefni');
    const served = script(res.text);
    expect(served.routes).toEqual(ROUTED.routes);
    expect(served.organization.ogImage).toBe('/og-ledgerlink.jpg');
  });

  test('an engine route the product does not describe keeps the engine meta', async () => {
    const res = await request(app).get('/en/verkefni').set('Host', PUBLIC_HOST);
    expect(title(res.text)).toBe(esc(composeTitle(tDown('en', 'meta.projects.title'), undefined, id)));
    expect(robots(res.text)).toBe('index, follow');
  });
});
