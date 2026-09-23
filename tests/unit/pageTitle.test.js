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
 * Since the identity seam (2026-09-22) both sides hold PAGE PARTS and compose
 * the document title from identity.brand (config/client.json): a part with
 * `{brand}` is substituted, a `titleMode: 'bare'` part is used as written, and
 * everything else gets brand.titleSuffix. So the parity is in two halves — the
 * parts and modes must match the server's tables, and the composition must
 * match server/config/identity.js composeTitle.
 *
 * ssrMeta.js is CommonJS but does not export its tables, so they are parsed out
 * of the source the same way tests/unit/admin-views-parity.test.js reads the
 * client's view list — a deliberate read-the-source test, not a unit test.
 *
 * babel-jest compiles the ESM module to CJS for require() (see money.client.test.js).
 * In the node environment utils/identity.js has no <script id="identity"> to
 * read and falls back to IDENTITY_DEFAULTS — the engine's Orange Smiley values.
 */
const fs = require('fs');
const path = require('path');
const { titleForRoute, composeTitle, __tables } = require('../../public/js/utils/pageTitle.js');
const { IDENTITY_DEFAULTS } = require('../../public/js/utils/identity.js');
const serverIdentity = require('../../server/config/identity');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../server/middleware/ssrMeta.js'), 'utf8');

/** ROUTE_META: '/thjonusta': { key: 'thjonusta', … } → { route: key } */
function serverRouteKeys() {
  const block = SRC.slice(SRC.indexOf('const ROUTE_META'));
  const body = block.slice(0, block.indexOf('\n};'));
  const out = {};
  for (const m of body.matchAll(/'(\/[^']*)':\s*\{\s*key:\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
}

/** DEFAULT_META: per locale, { key: { title, mode } } — `title` is the page
 *  part; `mode` is the optional `titleMode` that follows it on the same line. */
function serverTitles(locale) {
  const start = SRC.indexOf('const DEFAULT_META');
  const block = SRC.slice(start, SRC.indexOf('\n};', start));
  const lStart = block.indexOf(`  ${locale}: {`);
  const body = block.slice(lStart, block.indexOf('\n  },', lStart));
  const out = {};
  const re = /^\s{4}(\w+):\s*\{\s*title:\s*(['"])((?:\\.|(?!\2).)*)\2(?:,\s*titleMode:\s*'([\w-]+)')?/gm;
  for (const m of body.matchAll(re)) {
    out[m[1]] = { title: m[3].replace(/\\'/g, "'").replace(/\\"/g, '"'), mode: m[4] || undefined };
  }
  return out;
}

const BRAND = IDENTITY_DEFAULTS.brand;

describe('pageTitle mirrors the server', () => {
  const ROUTE_KEYS = serverRouteKeys();
  const TITLES = { en: serverTitles('en'), is: serverTitles('is') };

  test('the parser actually found the server tables', () => {
    // Guards the test itself: a refactor of ssrMeta.js that breaks these regexes
    // must fail loudly rather than silently asserting nothing.
    expect(Object.keys(ROUTE_KEYS).length).toBeGreaterThan(10);
    expect(Object.keys(TITLES.en).length).toBeGreaterThan(10);
    expect(Object.keys(TITLES.is).length).toBe(Object.keys(TITLES.en).length);
    expect(ROUTE_KEYS['/thjonusta']).toBe('thjonusta');
    // The home part carries the brand placeholder; the portfolio keeps bare titles.
    expect(TITLES.is.home.title).toContain('{brand}');
    expect(TITLES.en.shop.mode).toBe('bare');
    expect(Object.values(TITLES.en).some((t) => t.mode === 'bare')).toBe(true);
  });

  for (const [route, key] of Object.entries(serverRouteKeys())) {
    const client = __tables.PUBLIC_TITLES[route];
    if (!client) continue;

    for (const lc of ['en', 'is']) {
      test(`${route} (${lc}) carries the same page part and mode as DEFAULT_META.${key}`, () => {
        expect(client[lc]).toBe(TITLES[lc][key].title);
        expect(__tables.TITLE_MODE[route]).toBe(TITLES[lc][key].mode);
      });

      test(`${route} (${lc}) composes to the same document title as the server would`, () => {
        const server = serverIdentity.composeTitle(TITLES[lc][key].title, TITLES[lc][key].mode, IDENTITY_DEFAULTS);
        expect(titleForRoute(route, lc)).toBe(server);
      });
    }
  }

  test('every route the client titles is a real server route', () => {
    for (const route of Object.keys(__tables.PUBLIC_TITLES)) expect(ROUTE_KEYS[route]).toBeDefined();
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
    expect(titleForRoute('/', 'is')).toBe(`${BRAND.name} — hugbúnaðarhús knúið gervigreind`);
    expect(titleForRoute('/', 'is')).not.toContain('{brand}');
  });

  test('a detail route inherits its list title until the view supplies one', () => {
    expect(titleForRoute('/news/:slug', 'is')).toBe(titleForRoute('/news', 'is'));
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
