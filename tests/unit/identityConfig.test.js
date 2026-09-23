'use strict';

/**
 * The identity seam (2026-09-22): a downstream product owns its brand, visitor
 * locale, theme trio, hero clip, public nav, hidden surfaces and Organization
 * record in `identity.*` of config/client.json, resolved by
 * server/config/clientConfig.js and handed to the browser by ssrMeta. Three
 * things are pinned here:
 *
 *  1. THE ENGINE DEFAULTS ARE ORANGE SMILEY'S CURRENT VALUES, spelled out once.
 *     An engine with no `identity` block must behave exactly as it did before
 *     the seam, and the client fallback (public/js/utils/identity.js) must
 *     equal the server schema, so neither can drift on its own. These compare
 *     `defaults()` — the schema — never the resolved instance: in a downstream
 *     the instance is that product's, and this pin must still hold there
 *     (identity-seam-2, 2026-09-23). Only the "committed client.json equals
 *     the defaults" case is the engine's own (engine.json role).
 *  2. Validation: a picker without its default/root is rejected as a trio; ids,
 *     routes, nav entries, locales, asset paths and sameAs URLs are shape-checked.
 *  3. The hand-off: the <html data-*-theme> attributes and the
 *     <script id="identity"> tag, including the `</` escape, and that a
 *     NON-default identity flows through the config readers a downstream
 *     depends on (publicSurface, themes, i18n). The rendered page for the
 *     non-default case is tests/integration/identityDownstream.test.js.
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { resolveConfig, defaults } = require('../../server/config/clientConfig');
const {
  htmlIdentityAttrs, identityScriptTag, composeTitle, organizationAlternateNames, productRoutes, organizationDescription,
} = require('../../server/config/identity');
const {
  IDENTITY_DEFAULTS, resolveIdentity, publicNav, isHiddenRoute, routeMeta, routeLockFor,
} = require('../../public/js/utils/identity.js');

const resolve = (fileConfig = {}, env = {}) => resolveConfig({ fileConfig, env });
const { role } = JSON.parse(fs.readFileSync(path.join(__dirname, '../../engine.json'), 'utf8'));
const testEngine = role === 'engine' ? test : test.skip;

// ── 1. The engine defaults, pinned once ──────────────────────────────────────

const ORANGE_SMILEY = {
  brand: {
    name: 'Orange Smiley',
    legalName: 'Orange Smiley ehf.',
    alternateNames: ['Orangesmiley', 'Orange Smiley ehf.', 'orange smiley', 'Rekstrarkerfið', 'Rekstrarkerfi'],
    titleSuffix: ' — Orange Smiley',
  },
  locale: { publicDefault: 'is' },
  theme: { default: 'ember', root: 'classic', picker: ['ember', 'classic', 'midnight'], dark: ['ember', 'midnight'], swatches: {} },
  hero: {
    clip: '/assets/videos/hero-dc7df-v2.mp4',
    poster: '/assets/videos/hero-dc7df-v2-poster.jpg',
  },
  surface: {
    nav: [
      { route: '/thjonusta',    labelKey: 'nav.thjonusta' },
      { route: '/um-okkur',     labelKey: 'nav.umOkkur' },
      { route: '/hafa-samband', labelKey: 'nav.hafaSamband' },
    ],
    hiddenRoutes: ['/party', '/halli', '/about', '/news', '/shop', '/projects', '/contact', '/privacy', '/verkefni'],
    hiddenAdminViews: ['products', 'collections', 'bins', 'orders', 'discounts', 'sales', 'pos', 'background'],
  },
  // The engine has no routes of its own beyond ROUTE_META (identity-seam-3).
  routes: {},
  organization: {
    email: 'info@orangesmiley.is',
    description: 'Icelandic software company building and operating websites, online stores and business systems for small and medium businesses — one platform, one monthly subscription.',
    logo: '/favicon.svg',
    image: '/og-image.jpg',
    ogImage: '/og-image.jpg',
    addressLocality: 'Hafnarfjörður',
    addressCountry: 'IS',
    areaServed: 'Iceland',
    knowsAbout: ['Web Development', 'E-commerce', 'Inventory Management', 'Invoicing', 'VAT Accounting', 'Shopify Migration', 'Node.js', 'PostgreSQL'],
    sameAs: [],
  },
};

// JSON round-trip strips Object.freeze so toEqual compares plain shapes.
const plain = (v) => JSON.parse(JSON.stringify(v));
// The ENGINE identity — the schema defaults, not this instance's config.
const ENGINE = () => defaults().identity;

describe('identity — the engine defaults are Orange Smiley, pinned once', () => {
  test('the server schema defaults equal the pinned values', () => {
    expect(plain(ENGINE())).toEqual(ORANGE_SMILEY);
  });

  test('an empty config resolves to the same values with no warnings', () => {
    const { config, warnings } = resolve({});
    expect(plain(config.identity)).toEqual(ORANGE_SMILEY);
    expect(warnings).toEqual([]);
  });

  test('the client fallback (public/js/utils/identity.js) equals the server schema', () => {
    expect(plain(IDENTITY_DEFAULTS)).toEqual(plain(ENGINE()));
  });

  test('the defaults are handed out fresh — a caller cannot mutate the schema', () => {
    const a = defaults().identity;
    a.surface.nav[0].route = '/mutated';
    a.surface.hiddenRoutes.push('/mutated');
    a.routes['/mutated'] = { titleKey: 'x.y' };
    a.theme.swatches.mutated = { bg: '#000', fg: '#fff' };
    expect(plain(ENGINE())).toEqual(ORANGE_SMILEY);
  });

  testEngine("this instance's committed config/client.json spells the same values out (the engine only)", () => {
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/client.json'), 'utf8'));
    expect(file.identity).toBeDefined();
    expect(plain(resolve(file).config.identity)).toEqual(ORANGE_SMILEY);
  });

  test("this instance's committed config/client.json resolves without a warning (every repo)", () => {
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/client.json'), 'utf8'));
    expect(file.identity).toBeDefined();
    expect(resolve(file).warnings).toEqual([]);
  });
});

// ── 2. Validation ─────────────────────────────────────────────────────────────

describe('identity — validation', () => {
  test('a picker that lacks the default is rejected as a trio, keeping the engine set', () => {
    const { config, warnings } = resolve({ identity: { theme: { default: 'glacier', picker: ['ember', 'classic'] } } });
    expect(warnings).toEqual([expect.stringMatching(/identity\.theme\.picker .* does not include "glacier"/)]);
    expect(plain(config.identity.theme)).toEqual(ORANGE_SMILEY.theme);
  });

  test('the root may sit outside the picker (a two-theme product keeps :root as its unlisted base)', () => {
    const { config, warnings } = resolve({ identity: { theme: { picker: ['ember', 'midnight'] } } });
    expect(warnings).toEqual([]);
    expect(config.identity.theme.picker).toEqual(['ember', 'midnight']);
    expect(config.identity.theme.root).toBe('classic');
  });

  test('a coherent non-default set is accepted as given', () => {
    const theme = { default: 'glacier', root: 'classic', picker: ['glacier', 'classic', 'midnight', 'ember', 'lava', 'moss'], dark: ['midnight', 'ember', 'lava'], swatches: {} };
    const { config, warnings } = resolve({ identity: { theme } });
    expect(warnings).toEqual([]);
    expect(plain(config.identity.theme)).toEqual(theme);
  });

  test('theme.swatches is a map of theme id → { bg, fg } CSS colours (identity-seam-3)', () => {
    const swatches = { ledgerlink: { bg: '#0B1A2B', fg: 'rgb(255, 209, 102)' }, 'black-sand': { bg: '#111', fg: '#eee' } };
    const ok = resolve({ identity: { theme: { swatches } } });
    expect(ok.warnings).toEqual([]);
    expect(plain(ok.config.identity.theme.swatches)).toEqual(swatches);
    // The env layer carries it as JSON.
    expect(resolve({}, { CLIENT_CONFIG_IDENTITY_THEME_SWATCHES: JSON.stringify(swatches) }).config.identity.theme.swatches).toEqual(swatches);

    for (const bad of [
      { 'Bad Id': { bg: '#000', fg: '#fff' } },     // not a theme id
      { ember: { bg: '#000' } },                    // fg missing
      { ember: { bg: '#000', fg: 'url(x)' } },      // not a colour literal
      { ember: { bg: '#000', fg: '#fff', x: 1 } },  // unknown field
      { ember: '#000' },                            // not a record
    ]) {
      const { config, warnings } = resolve({ identity: { theme: { swatches: bad } } });
      expect(warnings).toEqual([expect.stringMatching(/identity\.theme\.swatches has entries that are not/)]);
      expect(config.identity.theme.swatches).toEqual({});
    }
    expect(resolve({ identity: { theme: { swatches: ['x'] } } }).warnings).toEqual([expect.stringMatching(/identity\.theme\.swatches must be an object/)]);
  });

  test('identity.routes is a map of route → { titleKey, descriptionKey?, titleMode?, noindex?, locale? } (identity-seam-3)', () => {
    const routes = {
      '/':          { titleKey: 'meta.landing.title', descriptionKey: 'meta.landing.description' },
      '/console':   { titleKey: 'meta.console.title', titleMode: 'bare', noindex: true },
      '/original':  { titleKey: 'meta.original.title', noindex: true, $comment: 'ignored, like everywhere in the file' },
      '/aron13ara': { titleKey: 'meta.aron13.title', titleMode: 'bare', locale: 'is' },
      '/verkefni':  { titleKey: 'meta.projects.title', locale: null },
    };
    const ok = resolve({ identity: { routes } });
    expect(ok.warnings).toEqual([]);
    const got = plain(ok.config.identity.routes);
    expect(got['/original']).toEqual({ titleKey: 'meta.original.title', noindex: true }); // $comment dropped
    expect(Object.keys(got)).toEqual(Object.keys(routes));
    expect(resolve({ identity: { routes: { $comment: 'only prose' } } }).config.identity.routes).toEqual({});
    // The env layer carries it as JSON.
    const env = resolve({}, { CLIENT_CONFIG_IDENTITY_ROUTES: '{"/console":{"titleKey":"meta.console.title","noindex":true}}' });
    expect(env.warnings).toEqual([]);
    expect(env.config.identity.routes).toEqual({ '/console': { titleKey: 'meta.console.title', noindex: true } });
    expect(resolve({}, { CLIENT_CONFIG_IDENTITY_ROUTES: 'not json' }).warnings).toEqual([expect.stringMatching(/identity\.routes must be a JSON object/)]);

    for (const [bad, why] of [
      [{ 'console': { titleKey: 'meta.console.title' } }, /not a bare route/],           // no leading slash
      [{ '/console/': { titleKey: 'meta.console.title' } }, /not a bare route/],         // trailing slash
      [{ '/en/console': { titleKey: 'meta.console.title' } }, /titleKey|not a bare route/], // a locale prefix is a segment; the shape passes, the lock ignores it — but the key must be an i18n key
      [{ '/console': 'Console' }, /not an object/],
      [{ '/console': {} }, /titleKey must be an i18n key/],
      [{ '/console': { titleKey: 'Console' } }, /titleKey must be an i18n key/],
      [{ '/console': { titleKey: 'meta.console.title', descriptionKey: 'x' } }, /descriptionKey/],
      [{ '/console': { titleKey: 'meta.console.title', titleMode: 'plain' } }, /titleMode/],
      [{ '/console': { titleKey: 'meta.console.title', noindex: 'yes' } }, /noindex/],
      [{ '/console': { titleKey: 'meta.console.title', locale: 'Icelandic' } }, /locale/],
      [{ '/console': { titleKey: 'meta.console.title', extra: 1 } }, /unknown field extra/],
    ]) {
      const { config, warnings } = resolve({ identity: { routes: bad } });
      if (bad['/en/console']) { // a valid shape: '/en/console' is just a route to the schema
        expect(warnings).toEqual([]);
        continue;
      }
      expect(warnings).toEqual([expect.stringMatching(/identity\.routes has entries that are not/)]);
      expect(warnings[0]).toMatch(why);
      expect(config.identity.routes).toEqual({});
    }
  });

  test('organization.ogImage is an asset path; the Organization image stays its own field', () => {
    expect(resolve({ identity: { organization: { ogImage: '/og-rk.jpg' } } }).config.identity.organization.ogImage).toBe('/og-rk.jpg');
    const { config, warnings } = resolve({ identity: { organization: { ogImage: 'og.jpg' } } });
    expect(warnings).toEqual([expect.stringMatching(/identity\.organization\.ogImage must be a site-relative path/)]);
    expect(config.identity.organization.ogImage).toBe('/og-image.jpg');
    expect(config.identity.organization.image).toBe('/og-image.jpg');
  });

  test('dark is a list of theme ids and may be empty', () => {
    expect(resolve({ identity: { theme: { dark: [] } } }).config.identity.theme.dark).toEqual([]);
    const { config, warnings } = resolve({ identity: { theme: { dark: ['Mid Night'] } } });
    expect(warnings).toEqual([expect.stringMatching(/identity\.theme\.dark has ids that do not match/)]);
    expect(config.identity.theme.dark).toEqual(ORANGE_SMILEY.theme.dark);
  });

  test('a theme id that would break html[data-theme] warns and keeps the default', () => {
    const { config, warnings } = resolve({ identity: { theme: { picker: ['ember', 'classic', 'Mid Night'] } } });
    expect(warnings).toEqual([expect.stringMatching(/identity\.theme\.picker has ids that do not match/)]);
    expect(config.identity.theme.picker).toEqual(ORANGE_SMILEY.theme.picker);
  });

  test('the env layer can set the picker as a comma list, and it still has to be coherent', () => {
    const ok = resolve({}, { CLIENT_CONFIG_IDENTITY_THEME_PICKER: 'ember,classic' });
    expect(ok.warnings).toEqual([]);
    expect(ok.config.identity.theme.picker).toEqual(['ember', 'classic']);

    const bad = resolve({}, { CLIENT_CONFIG_IDENTITY_THEME_PICKER: 'midnight' });
    expect(bad.warnings).toEqual([expect.stringMatching(/does not include "ember"/)]);
    expect(bad.config.identity.theme.picker).toEqual(ORANGE_SMILEY.theme.picker);
  });

  test('hidden routes must be bare routes — no locale prefix, no trailing slash, never "/"', () => {
    const { config, warnings } = resolve({ identity: { surface: { hiddenRoutes: ['/news/', '/'] } } });
    expect(warnings).toEqual([expect.stringMatching(/identity\.surface\.hiddenRoutes has entries that are not bare routes/)]);
    expect(config.identity.surface.hiddenRoutes).toEqual(ORANGE_SMILEY.surface.hiddenRoutes);
    expect(resolve({ identity: { surface: { hiddenRoutes: [] } } }).config.identity.surface.hiddenRoutes).toEqual([]);
  });

  test('a nav entry is { route, labelKey } and nothing else; the list may be empty', () => {
    const nav = [{ route: '/verkefni', labelKey: 'nav.projects' }, { route: '/news', labelKey: 'nav.news' }, { route: '/halli', labelKey: 'nav.halli' }];
    const ok = resolve({ identity: { surface: { nav } } });
    expect(ok.warnings).toEqual([]);
    expect(plain(ok.config.identity.surface.nav)).toEqual(nav);
    expect(resolve({ identity: { surface: { nav: [] } } }).config.identity.surface.nav).toEqual([]);

    for (const bad of [
      [{ route: '/news/', labelKey: 'nav.news' }],          // trailing slash
      [{ route: 'news', labelKey: 'nav.news' }],            // no leading slash
      [{ route: '/news', labelKey: 'News' }],               // a label, not a key
      [{ route: '/news', labelKey: 'nav.news', x: 1 }],     // an unknown field
      [{ route: '/news', labelKey: 'nav.news' }, { route: '/news', labelKey: 'nav.other' }], // repeated
      ['/news'],                                            // not a record
    ]) {
      const { config, warnings } = resolve({ identity: { surface: { nav: bad } } });
      expect(warnings).toEqual([expect.stringMatching(/identity\.surface\.nav (has entries that are not|must be an array of objects)/)]);
      expect(plain(config.identity.surface.nav)).toEqual(ORANGE_SMILEY.surface.nav);
    }
  });

  test('the env layer carries the nav as JSON', () => {
    const env = { CLIENT_CONFIG_IDENTITY_SURFACE_NAV: '[{"route":"/verkefni","labelKey":"nav.projects"}]' };
    const { config, warnings } = resolve({}, env);
    expect(warnings).toEqual([]);
    expect(plain(config.identity.surface.nav)).toEqual([{ route: '/verkefni', labelKey: 'nav.projects' }]);
    expect(resolve({}, { CLIENT_CONFIG_IDENTITY_SURFACE_NAV: 'not json' }).warnings)
      .toEqual([expect.stringMatching(/identity\.surface\.nav must be a JSON array of objects/)]);
  });

  test('an admin view id is a lowercase word; existence is the parity test’s job', () => {
    const { warnings } = resolve({ identity: { surface: { hiddenAdminViews: ['Orders'] } } });
    expect(warnings).toEqual([expect.stringMatching(/identity\.surface\.hiddenAdminViews has entries that are not admin view ids/)]);
  });

  test('the visitor-default locale is a locale id', () => {
    expect(resolve({ identity: { locale: { publicDefault: 'en' } } }).config.identity.locale.publicDefault).toBe('en');
    const { config, warnings } = resolve({ identity: { locale: { publicDefault: 'Icelandic' } } });
    expect(warnings).toEqual([expect.stringMatching(/identity\.locale\.publicDefault must be a lowercase locale id/)]);
    expect(config.identity.locale.publicDefault).toBe('is');
  });

  test('a hero clip is a site path or an https URL', () => {
    expect(resolve({ identity: { hero: { clip: 'https://cdn.example.is/hero.mp4' } } }).warnings).toEqual([]);
    const { warnings } = resolve({ identity: { hero: { clip: 'assets/videos/x.mp4' } } });
    expect(warnings).toEqual([expect.stringMatching(/identity\.hero\.clip must be a site-relative path/)]);
  });

  test('brand names must not be empty', () => {
    const { config, warnings } = resolve({ identity: { brand: { name: '  ' } } });
    expect(warnings).toEqual([expect.stringMatching(/identity\.brand\.name must not be empty/)]);
    expect(config.identity.brand.name).toBe('Orange Smiley');
  });

  test('sameAs entries are https URLs', () => {
    const { warnings } = resolve({ identity: { organization: { sameAs: ['http://facebook.com/x', 'nope'] } } });
    expect(warnings).toEqual([expect.stringMatching(/identity\.organization\.sameAs has entries that are not https URLs/)]);
  });
});

// ── 3. The hand-off ───────────────────────────────────────────────────────────
// Every helper takes the identity as an argument here — the engine's schema
// defaults or a synthetic downstream — never the module's resolved instance,
// which in a downstream is that product's.

const DOWNSTREAM = {
  brand: { name: 'Halli Smiley', legalName: 'Halli Smiley', alternateNames: ['hallismiley'], titleSuffix: ' — Halli Smiley' },
  locale: { publicDefault: 'en' },
  theme: { default: 'glacier', root: 'classic', picker: ['glacier', 'classic', 'midnight', 'ember', 'lava', 'moss'] },
  hero: { clip: '/assets/videos/waterfall.mp4', poster: '/assets/videos/waterfall-poster.jpg' },
  surface: {
    nav: [{ route: '/verkefni', labelKey: 'nav.projects' }, { route: '/news', labelKey: 'nav.news' }, { route: '/halli', labelKey: 'nav.halli' }],
    hiddenRoutes: ['/thjonusta', '/um-okkur', '/hafa-samband'],
    hiddenAdminViews: [],
  },
  organization: { sameAs: ['https://github.com/pepti'] },
};

describe('identity — the hand-off to the browser', () => {
  test('the <html> attributes carry the theme trio', () => {
    const attrs = htmlIdentityAttrs(ENGINE());
    expect(attrs).toBe('data-default-theme="ember" data-theme-picker="ember classic midnight" data-root-theme="classic"');
    const { config } = resolve({ identity: DOWNSTREAM });
    expect(htmlIdentityAttrs(config.identity))
      .toBe('data-default-theme="glacier" data-theme-picker="glacier classic midnight ember lava moss" data-root-theme="classic"');
  });

  test('the script tag round-trips the identity', () => {
    const tag = identityScriptTag(ENGINE());
    expect(tag.startsWith('<script id="identity" type="application/json">')).toBe(true);
    expect(tag.endsWith('</script>')).toBe(true);
    const json = tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(json)).toEqual(ORANGE_SMILEY);
  });

  test('a value cannot close the script element early: `</` is written as `<\\/`', () => {
    const { config } = resolve({ identity: { brand: { name: 'x</script><script>alert(1)</script>', legalName: '<!-- y' } } });
    const tag = identityScriptTag(config.identity);
    const body = tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(body).not.toContain('</script>');
    expect(body).not.toContain('<!--');
    expect(body).toContain('<\\/script>');
    // …and it is still the same JSON to a parser.
    expect(JSON.parse(body).brand.name).toBe('x</script><script>alert(1)</script>');
    expect(JSON.parse(body).brand.legalName).toBe('<!-- y');
  });

  test('composeTitle: suffix, {brand} substitution, bare', () => {
    const engine = ENGINE();
    expect(composeTitle('Þjónusta', undefined, engine)).toBe('Þjónusta — Orange Smiley');
    expect(composeTitle('{brand} — hugbúnaðarhús', undefined, engine)).toBe('Orange Smiley — hugbúnaðarhús');
    expect(composeTitle('Shop — Halli Smiley', 'bare', engine)).toBe('Shop — Halli Smiley');
    const { config } = resolve({ identity: DOWNSTREAM });
    expect(composeTitle('Services', undefined, config.identity)).toBe('Services — Halli Smiley');
    expect(composeTitle('{brand} — craft and code', undefined, config.identity)).toBe('Halli Smiley — craft and code');
  });

  test('the Organization alternateName is the brand plus its variants, minus the legal name', () => {
    expect(organizationAlternateNames(ENGINE())).toEqual(['Orange Smiley', 'Orangesmiley', 'orange smiley', 'Rekstrarkerfið', 'Rekstrarkerfi']);
    const { config } = resolve({ identity: DOWNSTREAM });
    expect(organizationAlternateNames(config.identity)).toEqual(['hallismiley']);
  });

  test('the client merges a hand-off over its defaults and ignores what it cannot use', () => {
    const merged = resolveIdentity({
      brand: { name: 'Halli Smiley', titleSuffix: 42 },
      theme: { picker: ['glacier', 3], default: 'glacier' },
      hero: null,
      surface: { nav: [{ route: '/news', labelKey: 'nav.news', extra: 'dropped' }, { route: '/halli', labelKey: 'nav.halli' }] },
      bogus: { x: 1 },
    });
    expect(merged.brand.name).toBe('Halli Smiley');
    expect(merged.brand.titleSuffix).toBe(' — Orange Smiley');   // wrong type → default
    expect(merged.theme.picker).toEqual(['ember', 'classic', 'midnight']); // not all strings → default
    expect(merged.theme.default).toBe('glacier');
    expect(merged.hero.clip).toBe('/assets/videos/hero-dc7df-v2.mp4');
    expect(merged.surface.nav).toEqual([{ route: '/news', labelKey: 'nav.news' }, { route: '/halli', labelKey: 'nav.halli' }]);
    expect(merged.bogus).toBeUndefined();
    // A nav list whose records do not fit falls back whole.
    expect(resolveIdentity({ surface: { nav: [{ route: '/news' }] } }).surface.nav).toEqual(ORANGE_SMILEY.surface.nav);
    expect(resolveIdentity({ surface: { nav: ['/news'] } }).surface.nav).toEqual(ORANGE_SMILEY.surface.nav);
    expect(plain(resolveIdentity(null))).toEqual(ORANGE_SMILEY);
    expect(plain(resolveIdentity(undefined))).toEqual(ORANGE_SMILEY);
  });

  test('the client merges the maps — routes and theme.swatches — record by record (identity-seam-3)', () => {
    const merged = resolveIdentity({
      routes: {
        '/console': { titleKey: 'meta.console.title', titleMode: 'bare', noindex: true, locale: null, fn: () => 1, nested: { x: 1 } },
        '/broken': 'not a record',
      },
      theme: { swatches: { ledgerlink: { bg: '#0B1A2B', fg: '#FFD166' }, bad: 'x' } },
      organization: { ogImage: '/og-ll.jpg' },
    });
    expect(merged.routes).toEqual({ '/console': { titleKey: 'meta.console.title', titleMode: 'bare', noindex: true, locale: null } });
    expect(merged.theme.swatches).toEqual({ ledgerlink: { bg: '#0B1A2B', fg: '#FFD166' } });
    expect(merged.organization.ogImage).toBe('/og-ll.jpg');
    // A map that is not an object falls back to the empty default, never to null.
    expect(resolveIdentity({ routes: null }).routes).toEqual({});
    expect(resolveIdentity({ routes: ['/x'] }).routes).toEqual({});
    expect(resolveIdentity({ theme: { swatches: null } }).theme.swatches).toEqual({});
    expect(resolveIdentity({ theme: { swatches: 'x' } }).theme.swatches).toEqual({});
  });

  test('productRoutes (server) and routeMeta (client) normalise an entry the same way', () => {
    const { config } = resolve({ identity: { routes: {
      '/console':   { titleKey: 'meta.console.title', titleMode: 'bare', noindex: true },
      '/aron13ara': { titleKey: 'meta.aron13.title', locale: 'is' },
      '/':          { titleKey: 'meta.landing.title', descriptionKey: 'meta.landing.description' },
    } } });
    const server = productRoutes(config.identity);
    expect(server).toEqual({
      '/console':   { titleKey: 'meta.console.title', descriptionKey: null, titleMode: 'bare',   noindex: true,  locale: null },
      '/aron13ara': { titleKey: 'meta.aron13.title',  descriptionKey: null, titleMode: 'suffix', noindex: false, locale: 'is' },
      '/':          { titleKey: 'meta.landing.title', descriptionKey: 'meta.landing.description', titleMode: 'suffix', noindex: false, locale: null },
    });
    const client = resolveIdentity(config.identity);
    for (const route of Object.keys(server)) expect(routeMeta(route, client)).toEqual(server[route]);
    expect(routeMeta('/nope', client)).toBeNull();
    expect(productRoutes(ENGINE())).toEqual({});
    expect(routeMeta('/', resolveIdentity(ENGINE()))).toBeNull();
    // The client lock mirrors the server's rule: prefix-aware, '/' exact.
    expect(routeLockFor('/aron13ara', client)).toBe('is');
    expect(routeLockFor('/aron13ara/x', client)).toBe('is');
    expect(routeLockFor('/aron13arax', client)).toBeNull();
    expect(routeLockFor('/console', client)).toBeNull();
    const landing = resolveIdentity({ routes: { '/': { titleKey: 'meta.landing.title', locale: 'en' } } });
    expect(routeLockFor('/', landing)).toBe('en');
    expect(routeLockFor('/anything', landing)).toBeNull();
  });

  test('organizationDescription: a literal as written, an i18n key through the tables', () => {
    const tables = { is: { 'org.description': 'Íslenskt' }, en: { 'org.description': 'Icelandic' } };
    const i18n = { has: (lc, k) => tables[lc][k] !== undefined, t: (lc, k) => tables[lc][k] };
    expect(organizationDescription('is', i18n, ENGINE())).toBe(ORANGE_SMILEY.organization.description);
    const { config } = resolve({ identity: { organization: { description: 'org.description' } } });
    expect(organizationDescription('is', i18n, config.identity)).toBe('Íslenskt');
    expect(organizationDescription('en', i18n, config.identity)).toBe('Icelandic');
    // A key the tables do not carry is emitted as written — never the empty string.
    const missing = resolve({ identity: { organization: { description: 'org.missing' } } }).config.identity;
    expect(organizationDescription('en', i18n, missing)).toBe('org.missing');
  });

  test('publicNav (client) is the nav minus the hidden routes, prefix-aware like the server', () => {
    const engine = resolveIdentity(ENGINE());
    expect(publicNav(engine).map((e) => e.route)).toEqual(['/thjonusta', '/um-okkur', '/hafa-samband']);
    expect(isHiddenRoute('/news/some-slug', engine)).toBe(true);
    expect(isHiddenRoute('/newsletter', engine)).toBe(false);
    expect(isHiddenRoute('/thjonusta', engine)).toBe(false);

    const both = resolveIdentity({ surface: { nav: [{ route: '/news', labelKey: 'nav.news' }, { route: '/verkefni', labelKey: 'nav.projects' }], hiddenRoutes: ['/news'] } });
    expect(publicNav(both).map((e) => e.route)).toEqual(['/verkefni']); // hidden wins

    const { config } = resolve({ identity: DOWNSTREAM });
    expect(publicNav(resolveIdentity(config.identity)).map((e) => e.route)).toEqual(['/verkefni', '/news', '/halli']);
    expect(isHiddenRoute('/thjonusta', resolveIdentity(config.identity))).toBe(true);
  });
});

// ── 3b. A non-default identity reaches the config readers ────────────────────
// What a downstream needs: with its own client.json, the server-side readers
// (publicSurface, themes, i18n) resolve to ITS values, not the engine's.

describe('identity — a downstream identity flows through the config readers', () => {
  let dir;
  const savedFile = process.env.CLIENT_CONFIG_FILE;
  const savedLocale = process.env.PUBLIC_DEFAULT_LOCALE;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-seam-'));
    fs.writeFileSync(path.join(dir, 'client.json'), JSON.stringify({ identity: DOWNSTREAM }));
    process.env.CLIENT_CONFIG_FILE = path.join(dir, 'client.json');
    delete process.env.PUBLIC_DEFAULT_LOCALE;
  });

  afterAll(() => {
    if (savedFile === undefined) delete process.env.CLIENT_CONFIG_FILE;
    else process.env.CLIENT_CONFIG_FILE = savedFile;
    if (savedLocale !== undefined) process.env.PUBLIC_DEFAULT_LOCALE = savedLocale;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('publicSurface, themes and i18n read the downstream values', () => {
    jest.isolateModules(() => {
      const { clientConfig, problems } = require('../../server/config/clientConfig');
      expect(problems).toEqual([]);
      expect(clientConfig.identity.brand.name).toBe('Halli Smiley');

      const { HIDDEN_PUBLIC_ROUTES, PUBLIC_NAV, LEGAL_ROUTES, isHiddenRoute: hidden } = require('../../server/config/publicSurface');
      expect(HIDDEN_PUBLIC_ROUTES).toEqual(['/thjonusta', '/um-okkur', '/hafa-samband']);
      expect(hidden('/news')).toBe(false);
      expect(hidden('/shop/some-slug')).toBe(false);
      expect(hidden('/thjonusta')).toBe(true);
      expect(PUBLIC_NAV).toEqual(DOWNSTREAM.surface.nav);
      expect(LEGAL_ROUTES).toEqual(['/personuvernd', '/terms']);

      const { THEMES } = require('../../server/config/themes');
      expect(THEMES).toEqual(['glacier', 'classic', 'midnight', 'ember', 'lava', 'moss']);

      const { PUBLIC_DEFAULT_LOCALE, DEFAULT_LOCALE } = require('../../server/config/i18n');
      expect(PUBLIC_DEFAULT_LOCALE).toBe('en');
      expect(DEFAULT_LOCALE).toBe('en'); // the content dimension is untouched
    });
  });

  test('the env var PUBLIC_DEFAULT_LOCALE still wins over the identity, as before the seam', () => {
    process.env.PUBLIC_DEFAULT_LOCALE = 'is';
    try {
      jest.isolateModules(() => {
        expect(require('../../server/config/i18n').PUBLIC_DEFAULT_LOCALE).toBe('is');
      });
    } finally {
      delete process.env.PUBLIC_DEFAULT_LOCALE;
    }
  });
});
