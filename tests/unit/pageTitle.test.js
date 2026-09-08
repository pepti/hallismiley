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
 * ssrMeta.js is CommonJS but does not export its tables, so they are parsed out
 * of the source the same way tests/unit/admin-views-parity.test.js reads the
 * client's view list — a deliberate read-the-source test, not a unit test.
 *
 * babel-jest compiles the ESM module to CJS for require() (see money.client.test.js).
 */
const fs = require('fs');
const path = require('path');
const { titleForRoute, __tables } = require('../../public/js/utils/pageTitle.js');

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

/** DEFAULT_META: per locale, { key: title } */
function serverTitles(locale) {
  const start = SRC.indexOf('const DEFAULT_META');
  const block = SRC.slice(start, SRC.indexOf('\n};', start));
  const lStart = block.indexOf(`  ${locale}: {`);
  const body = block.slice(lStart, block.indexOf('\n  },', lStart));
  const out = {};
  for (const m of body.matchAll(/^\s{4}(\w+):\s*\{\s*title:\s*(['"])((?:\\.|(?!\2).)*)\2/gm)) {
    out[m[1]] = m[3].replace(/\\'/g, "'").replace(/\\"/g, '"');
  }
  return out;
}

describe('pageTitle mirrors the server', () => {
  const ROUTE_KEYS = serverRouteKeys();
  const TITLES = { en: serverTitles('en'), is: serverTitles('is') };

  test('the parser actually found the server tables', () => {
    // Guards the test itself: a refactor of ssrMeta.js that breaks these regexes
    // must fail loudly rather than silently asserting nothing.
    expect(Object.keys(ROUTE_KEYS).length).toBeGreaterThan(10);
    expect(Object.keys(TITLES.en).length).toBeGreaterThan(10);
    expect(Object.keys(TITLES.is).length).toBe(Object.keys(TITLES.en).length);
    expect(ROUTE_KEYS['/shop']).toBe('shop');
    expect(TITLES.is.home).toContain('Halli Smiley');
  });

  // The base has no intentional divergence: it IS the brand its SSR titles name.
  // A re-skinned instance may diverge (orangesmiley re-brands the hidden
  // portfolio routes) and lists its exceptions here with the reason.
  const INTENTIONAL = new Set();

  for (const [route, key] of Object.entries(serverRouteKeys())) {
    const client = __tables.PUBLIC_TITLES[route];
    if (!client || INTENTIONAL.has(route)) continue;

    for (const lc of ['en', 'is']) {
      test(`${route} (${lc}) matches DEFAULT_META.${key}`, () => {
        expect(titleForRoute(route, lc)).toBe(TITLES[lc][key]);
      });
    }
  }

  test('every intentional divergence is still a real server route', () => {
    for (const route of INTENTIONAL) expect(ROUTE_KEYS[route]).toBeDefined();
  });
});

describe('titleForRoute', () => {
  test('every /admin route shares one label rather than leaking the landing title', () => {
    expect(titleForRoute('/admin/leads', 'is')).toBe('Stjórnborð — Halli Smiley');
    expect(titleForRoute('/admin/books/vat', 'is')).toBe('Stjórnborð — Halli Smiley');
    expect(titleForRoute('/admin/accounts/:id', 'en')).toBe('Admin — Halli Smiley');
  });

  test('client-only sections get the site suffix', () => {
    expect(titleForRoute('/checkout', 'is')).toBe('Ganga frá pöntun — Halli Smiley');
    expect(titleForRoute('/cart', 'en')).toBe('Cart — Halli Smiley');
  });

  test('a detail route inherits its list title until the view supplies one', () => {
    expect(titleForRoute('/news/:slug', 'is')).toBe(titleForRoute('/news', 'is'));
    expect(titleForRoute('/projects/:id', 'en')).toBe(titleForRoute('/projects', 'en'));
  });

  test('an unknown route falls back to the site name, never to empty', () => {
    expect(titleForRoute('/nope', 'is')).toBe('Halli Smiley');
    expect(titleForRoute(undefined, 'en')).toBe('Halli Smiley');
    expect(titleForRoute(null, 'is')).toBe('Halli Smiley');
  });

  test('an unknown locale is treated as English, not as a crash', () => {
    expect(titleForRoute('/cart', 'de')).toBe('Cart — Halli Smiley');
  });
});
