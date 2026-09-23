/**
 * public/js/utils/pageTitle.js mirrors the PUBLIC titles the server writes in
 * server/middleware/ssrMeta.js, so a direct load of /thjonusta and a client-side
 * navigation to it title the tab identically.
 *
 * icelandicstore solved the same problem and left the mirror as a comment
 * ("⚠️ If you change a public title there, change it here too"). A comment does
 * not survive a copy edit six months later, so this reads the server file and
 * fails the build on any drift.
 *
 * Since identity-seam-2 (2026-09-23) both sides hold i18n KEYS
 * (`meta.<key>.title`) rather than text, and the text lives in the i18n tables
 * — server/i18n/<lc>.json for the SSR head, public/js/i18n/<lc>.json for the
 * SPA — so a product overrides a page part in its product.<lc>.json. The parity
 * is therefore in three halves: the client key and mode per route must equal
 * the server's for that route's DEFAULT_META key; the two tables must carry the
 * SAME TEXT for every title key in both locales (or a load and a click would
 * disagree); and the composition (server/config/identity.js composeTitle vs
 * the client twin) must match.
 *
 * ssrMeta.js is CommonJS but does not export its tables, so they are parsed out
 * of the source the same way tests/unit/admin-views-parity.test.js reads the
 * client's view list — a deliberate read-the-source test, not a unit test.
 *
 * babel-jest compiles the ESM module to CJS for require() (see money.client.test.js).
 * In the node environment utils/identity.js has no <script id="identity"> to
 * read and falls back to IDENTITY_DEFAULTS — the engine's Orange Smiley values;
 * the client i18n module is replaced by one that reads the on-disk tables for
 * the locale under test (the SPA reads the fetched table the same way).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const CLIENT = { en: { ...readJson('public/js/i18n/en.json'), ...readJson('public/js/i18n/product.en.json') },
  is: { ...readJson('public/js/i18n/is.json'), ...readJson('public/js/i18n/product.is.json') } };
const SERVER = { en: { ...readJson('server/i18n/en.json'), ...readJson('server/i18n/product.en.json') },
  is: { ...readJson('server/i18n/is.json'), ...readJson('server/i18n/product.is.json') } };

// The SPA's t() over the on-disk table of `mockLocale.lc`, English fallback —
// exactly what public/js/i18n/i18n.js does with the fetched tables.
const mockLocale = { lc: 'en' };
jest.mock('../../public/js/i18n/i18n.js', () => {
  const tables = {
    en: { ...require('../../public/js/i18n/en.json'), ...require('../../public/js/i18n/product.en.json') },
    is: { ...require('../../public/js/i18n/is.json'), ...require('../../public/js/i18n/product.is.json') },
  };
  return { t: (key) => tables[mockLocale.lc][key] ?? tables.en[key] ?? key };
});

const { titleForRoute, composeTitle, __tables } = require('../../public/js/utils/pageTitle.js');
const { IDENTITY_DEFAULTS } = require('../../public/js/utils/identity.js');
const serverIdentity = require('../../server/config/identity');

const SRC = fs.readFileSync(path.join(ROOT, 'server/middleware/ssrMeta.js'), 'utf8');

/** ROUTE_META: '/thjonusta': { key: 'thjonusta', … } → { route: key } */
function serverRouteKeys() {
  const block = SRC.slice(SRC.indexOf('const ROUTE_META'));
  const body = block.slice(0, block.indexOf('\n};'));
  const out = {};
  for (const m of body.matchAll(/'(\/[^']*)':\s*\{\s*key:\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

/** DEFAULT_META: { key: { titleKey, mode } } — `title` is the i18n key of the
 *  page part; `mode` is the optional `titleMode` that follows it on the line. */
function serverMeta() {
  const start = SRC.indexOf('const DEFAULT_META');
  const body = SRC.slice(start, SRC.indexOf('\n};', start));
  const out = {};
  const re = /^\s{2}(\w+):\s*\{\s*title:\s*'([\w.]+)'(?:,\s*titleMode:\s*'([\w-]+)')?/gm;
  for (const m of body.matchAll(re)) out[m[1]] = { titleKey: m[2], mode: m[3] || undefined };
  return out;
}

const BRAND = IDENTITY_DEFAULTS.brand;
const ROUTE_KEYS = serverRouteKeys();
const META = serverMeta();

describe('pageTitle mirrors the server', () => {
  test('the parser actually found the server tables', () => {
    // Guards the test itself: a refactor of ssrMeta.js that breaks these regexes
    // must fail loudly rather than silently asserting nothing.
    expect(Object.keys(ROUTE_KEYS).length).toBeGreaterThan(10);
    expect(Object.keys(META).length).toBeGreaterThan(10);
    expect(ROUTE_KEYS['/thjonusta']).toBe('thjonusta');
    expect(META.home.titleKey).toBe('meta.home.title');
    expect(META.shop.mode).toBe('bare');
    expect(Object.values(META).some((m) => m.mode === 'bare')).toBe(true);
    // Every DEFAULT_META key is the i18n form, and every ROUTE_META key has one.
    for (const m of Object.values(META)) expect(m.titleKey).toMatch(/^meta\.\w+\.title$/);
    for (const key of Object.values(ROUTE_KEYS)) expect(META[key]).toBeDefined();
  });

  for (const [route, key] of Object.entries(ROUTE_KEYS)) {
    const clientKey = __tables.PUBLIC_TITLES[route];
    if (!clientKey) continue;

    test(`${route} names the same i18n key and mode as DEFAULT_META.${key}`, () => {
      expect(clientKey).toBe(META[key].titleKey);
      expect(__tables.TITLE_MODE[route]).toBe(META[key].mode);
    });

    for (const lc of ['en', 'is']) {
      test(`${route} (${lc}): the SPA table and the server table carry the same text`, () => {
        expect(CLIENT[lc][clientKey]).toBeDefined();
        expect(SERVER[lc][clientKey]).toBeDefined();
        expect(CLIENT[lc][clientKey]).toBe(SERVER[lc][clientKey]);
      });

      test(`${route} (${lc}) composes to the same document title as the server would`, () => {
        mockLocale.lc = lc;
        const server = serverIdentity.composeTitle(SERVER[lc][META[key].titleKey], META[key].mode, IDENTITY_DEFAULTS);
        expect(titleForRoute(route, lc)).toBe(server);
      });
    }
  }

  test('every route the client titles is a real server route', () => {
    for (const route of Object.keys(__tables.PUBLIC_TITLES)) expect(ROUTE_KEYS[route]).toBeDefined();
  });

  test('the home part carries the brand placeholder, and the text in both locales differs', () => {
    expect(CLIENT.is['meta.home.title']).toContain('{brand}');
    expect(CLIENT.en['meta.home.title']).toContain('{brand}');
    expect(CLIENT.is['meta.thjonusta.title']).not.toBe(CLIENT.en['meta.thjonusta.title']);
  });
});

describe('composeTitle (client) agrees with composeTitle (server)', () => {
  test.each([
    ['a page part gets the suffix', 'Þjónusta', undefined],
    ['a {brand} part is substituted, not suffixed', '{brand} — hugbúnaðarhús', undefined],
    ['a bare part is used as written', 'Shop — Halli Smiley', 'bare'],
    ['an empty part is just the suffix', '', undefined],
  ])('%s', (_label, part, mode) => {
    expect(composeTitle(part, mode)).toBe(serverIdentity.composeTitle(part, mode, IDENTITY_DEFAULTS));
  });
});

describe('titleForRoute', () => {
  const suffix = BRAND.titleSuffix;

  test('every /admin route shares one label rather than leaking the landing title', () => {
    expect(titleForRoute('/admin/leads', 'is')).toBe(`Stjórnborð${suffix}`);
    expect(titleForRoute('/admin/books/vat', 'is')).toBe(`Stjórnborð${suffix}`);
    expect(titleForRoute('/admin/accounts/:id', 'en')).toBe(`Admin${suffix}`);
  });

  test('client-only sections get the brand suffix', () => {
    expect(titleForRoute('/checkout', 'is')).toBe(`Ganga frá pöntun${suffix}`);
    expect(titleForRoute('/cart', 'en')).toBe(`Cart${suffix}`);
  });

  test('the home title leads with the brand', () => {
    // The home part is the table's (engine + this repo's overlay), never the
    // engine's wording as a literal — a downstream overrides meta.home.title.
    mockLocale.lc = 'is';
    expect(titleForRoute('/', 'is')).toBe(CLIENT.is['meta.home.title'].split('{brand}').join(BRAND.name));
    expect(titleForRoute('/', 'is').startsWith(BRAND.name)).toBe(true);
    expect(titleForRoute('/', 'is')).not.toContain('{brand}');
  });

  test('a detail route inherits its list title until the view supplies one', () => {
    mockLocale.lc = 'is';
    expect(titleForRoute('/news/:slug', 'is')).toBe(titleForRoute('/news', 'is'));
    mockLocale.lc = 'en';
    expect(titleForRoute('/verkefni/:id', 'en')).toBe(titleForRoute('/verkefni', 'en'));
  });

  test('an unknown route falls back to the brand name, never to empty', () => {
    expect(titleForRoute('/nope', 'is')).toBe(BRAND.name);
    expect(titleForRoute(undefined, 'en')).toBe(BRAND.name);
    expect(titleForRoute(null, 'is')).toBe(BRAND.name);
  });

  test('an unknown locale is treated as English, not as a crash', () => {
    expect(titleForRoute('/cart', 'de')).toBe(`Cart${suffix}`);
  });
});
