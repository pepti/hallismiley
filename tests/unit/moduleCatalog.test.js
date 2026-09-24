/**
 * Module switches (R4, 2026-09-24): the catalogue, the preset resolution and
 * the two halves of the gate.
 *
 * server/config/moduleCatalog.js is hand-kept data that names real code — API
 * mounts in app.js, SPA routes in router.js, admin view ids, registry
 * features. Data like that rots silently: a renamed mount would leave its
 * module "off" in the catalogue while the API still answers. So the first
 * block reads the sources and fails on any drift; the rest pins the rules the
 * readers rely on (longest prefix wins, an explicit switch beats the preset,
 * the client resolves routes exactly as the server does).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const { MODULES, MODULE_IDS, TIERS, PRESETS, presetIncludes } = require('../../server/config/moduleCatalog');
const { resolveConfig, envNameFor } = require('../../server/config/clientConfig');
const { moduleState, moduleHandoff, modulesScriptTag, ownerOf } = require('../../server/config/modules');
const { ADMIN_VIEW_IDS } = require('../../server/auth/adminViews');
const { loadFeatures } = require('../../scripts/features-index');
const { normalizeModules, routeDisabledIn } = require('../../public/js/utils/modules.js');

const { role } = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine.json'), 'utf8'));
const testEngine = role === 'engine' ? test : test.skip;

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const under = (p, prefix) => p === prefix || p.startsWith(prefix + '/');
const resolved = (fileConfig = {}, env = {}) => resolveConfig({ fileConfig, env });

describe('the catalogue names real code', () => {
  const appSrc = read('server/app.js');
  // Every mount path app.js registers: app.use('/x', …) and app.post('/x', …).
  const mounts = [...appSrc.matchAll(/app\.(?:use|post|get)\(\s*'(\/[^']*)'/g)].map((m) => m[1]);
  const routerSrc = read('public/js/router.js');
  const patterns = [...routerSrc.matchAll(/pattern:\s*'([^']+)'/g)].map((m) => m[1]);

  test('every API prefix is a mount, or a path under one', () => {
    const bad = [];
    for (const [id, m] of Object.entries(MODULES)) {
      for (const p of m.api) if (!mounts.some((mt) => mt !== '/' && under(p, mt))) bad.push(`${id}: ${p}`);
    }
    expect(bad).toEqual([]);
  });

  test('every upload prefix is an /assets mount in app.js', () => {
    const bad = [];
    for (const [id, m] of Object.entries(MODULES)) {
      for (const p of m.assets) if (!p.startsWith('/assets/') || !mounts.includes(p)) bad.push(`${id}: ${p}`);
    }
    expect(bad).toEqual([]);
  });

  test('every route is an SPA route, or the prefix of one', () => {
    const bad = [];
    for (const [id, m] of Object.entries(MODULES)) {
      for (const r of m.routes) if (!patterns.some((pt) => under(pt, r))) bad.push(`${id}: ${r}`);
    }
    expect(bad).toEqual([]);
  });

  test('routes are bare (no locale, no trailing slash) and prefixes are unique across modules', () => {
    const seen = new Map();
    const bad = [];
    for (const [id, m] of Object.entries(MODULES)) {
      for (const p of [...m.routes, ...m.api, ...m.assets]) {
        if (!/^\/[a-z0-9][a-z0-9/_-]*$/i.test(p) || p.endsWith('/')) bad.push(`${id}: ${p} is not bare`);
        if (/^\/(is|en)\//.test(p)) bad.push(`${id}: ${p} carries a locale`);
        if (seen.has(p)) bad.push(`${p} claimed by ${seen.get(p)} and ${id}`);
        seen.set(p, id);
      }
    }
    expect(bad).toEqual([]);
  });

  test('admin views are real ids, each owned by at most one module', () => {
    const owners = new Map();
    const bad = [];
    for (const [id, m] of Object.entries(MODULES)) {
      for (const v of m.adminViews) {
        if (!ADMIN_VIEW_IDS.includes(v)) bad.push(`${id}: ${v} is not in ADMIN_VIEW_IDS`);
        if (owners.has(v)) bad.push(`${v} owned by ${owners.get(v)} and ${id}`);
        owners.set(v, id);
      }
    }
    expect(bad).toEqual([]);
  });

  test('the registry and the catalogue agree on every module flag, both ways', () => {
    const features = loadFeatures(ROOT).filter((f) => !f.foreign);
    const byId = new Map(features.map((f) => [f.id, f]));
    const bad = [];
    for (const [id, m] of Object.entries(MODULES)) {
      for (const fid of m.features) {
        const f = byId.get(fid);
        if (!f) bad.push(`${id}: no feature ${fid}`);
        else if (f.flag !== `modules.${id}.enabled`) bad.push(`${fid}: flag ${f.flag}, expected modules.${id}.enabled`);
      }
    }
    for (const f of features) {
      const m = /^modules\.([A-Za-z]+)\.enabled$/.exec(f.flag || '');
      if (!m || m[1] === 'selfUpdate') continue;
      if (!MODULES[m[1]] || !MODULES[m[1]].features.includes(f.id)) bad.push(`${f.id}: flag ${f.flag} but not listed in the catalogue`);
    }
    expect(bad).toEqual([]);
  });
});

describe('presets', () => {
  test('the tiers nest: vefur ⊂ verslun ⊂ rekstur ⊂ all', () => {
    const on = (p) => MODULE_IDS.filter((id) => presetIncludes(p, id));
    expect(on('vefur')).toEqual(['news']);
    expect(on('verslun')).toEqual(['shop', 'pos', 'news', 'signup']);
    expect(on('rekstur')).toEqual(['shop', 'pos', 'books', 'news', 'signup']);
    expect(on('all')).toEqual(MODULE_IDS);
    expect(PRESETS).toEqual(['all', ...TIERS]);
  });

  test('the default is every module on — the engine before R4', () => {
    const { config, warnings } = resolved();
    expect(warnings).toEqual([]);
    expect(config.modules.preset).toBe('all');
    for (const id of MODULE_IDS) expect([id, config.modules[id].enabled]).toEqual([id, true]);
  });

  test('a preset switches on exactly its tier', () => {
    const { config } = resolved({ modules: { preset: 'verslun' } });
    const on = MODULE_IDS.filter((id) => config.modules[id].enabled);
    expect(on).toEqual(['shop', 'pos', 'news', 'signup']);
  });

  test('an explicit switch beats the preset, from the file and from the env', () => {
    const { config } = resolved(
      { modules: { preset: 'rekstur', books: { enabled: false }, news: { enabled: true } } },
      { CLIENT_CONFIG_MODULES_POS_ENABLED: 'false', CLIENT_CONFIG_MODULES_SALES_OPS_ENABLED: 'true' },
    );
    expect(MODULE_IDS.filter((id) => config.modules[id].enabled)).toEqual(['shop', 'news', 'salesOps', 'signup']);
  });

  test('an env preset re-derives the switches the file left alone', () => {
    const { config } = resolved(
      { modules: { preset: 'rekstur', shop: { enabled: true } } },
      { CLIENT_CONFIG_MODULES_PRESET: 'vefur' },
    );
    expect(MODULE_IDS.filter((id) => config.modules[id].enabled)).toEqual(['shop', 'news']);
  });

  test('an unknown preset warns and keeps `all`; a bad switch warns and falls to the preset', () => {
    const { config, warnings } = resolved({ modules: { preset: 'gold', shop: { enabled: 'maybe' } } });
    expect(config.modules.preset).toBe('all');
    expect(config.modules.shop.enabled).toBe(true);
    expect(warnings).toEqual([
      expect.stringContaining('modules.preset must be one of all, vefur, verslun, rekstur'),
      expect.stringContaining('modules.shop.enabled must be a boolean'),
    ]);
  });

  test('env names follow the schema path', () => {
    expect(envNameFor(['modules', 'preset'])).toBe('CLIENT_CONFIG_MODULES_PRESET');
    expect(envNameFor(['modules', 'salesOps', 'enabled'])).toBe('CLIENT_CONFIG_MODULES_SALES_OPS_ENABLED');
  });

  testEngine('this instance (the engine) keeps every module: its portfolio surfaces are HIDDEN, not off', () => {
    const { clientConfig } = require('../../server/config/clientConfig');
    expect(clientConfig.modules.preset).toBe('all');
    expect(MODULE_IDS.filter((id) => !clientConfig.modules[id].enabled)).toEqual([]);
  });
});

describe('the gate', () => {
  const stateFor = (fileConfig) => moduleState(resolved(fileConfig).config);

  test('longest prefix wins — the till outlives bókhald, and bókhald without a till still hides it', () => {
    const noBooks = stateFor({ modules: { preset: 'verslun' } });
    expect(noBooks.isDisabledRoute('/admin/books')).toBe(true);
    expect(noBooks.isDisabledRoute('/admin/books/vat')).toBe(true);
    expect(noBooks.isDisabledRoute('/admin/books/pos')).toBe(false);
    expect(noBooks.isDisabledRequestPath('/api/v1/admin/bookkeeping/invoices')).toBe(true);
    expect(noBooks.isDisabledRequestPath('/api/v1/admin/bookkeeping/pos/day')).toBe(false);

    const noTill = stateFor({ modules: { pos: { enabled: false } } });
    expect(noTill.isDisabledRoute('/admin/books/pos')).toBe(true);
    expect(noTill.isDisabledRoute('/admin/books')).toBe(false);
    expect(noTill.disabledAdminViews).toEqual(['pos']);
  });

  test('prefixes match on a "/" boundary, and core paths belong to no module', () => {
    const vefur = stateFor({ modules: { preset: 'vefur' } });
    expect(vefur.isDisabledRoute('/shop/some-product')).toBe(true);
    expect(vefur.isDisabledRoute('/shopping')).toBe(false);
    expect(vefur.isDisabledRoute('/SHOP/X')).toBe(true);
    expect(vefur.isDisabledRequestPath('/API/V1/Shop/products')).toBe(true);
    expect(vefur.isDisabledRequestPath('/api/v1/seller')).toBe(true);
    expect(vefur.isDisabledRequestPath('/api/v1/seller-publish')).toBe(true);
    expect(vefur.isDisabledRequestPath('/api/v1/content/halli_bio')).toBe(true);
    expect(vefur.isDisabledRequestPath('/api/v1/content/home_hero')).toBe(false);
    for (const core of ['/', '/thjonusta', '/hafa-samband', '/admin', '/admin/leads', '/admin/users', '/profile']) {
      expect([core, ownerOf(core, 'routes')]).toEqual([core, null]);
    }
    expect(ownerOf('/api/v1/admin/leads', 'api')).toBeNull();
  });

  test('the client resolves every catalogued route exactly as the server does', () => {
    const probes = [];
    for (const m of Object.values(MODULES)) for (const r of m.routes) probes.push(r, `${r}/x`, `${r}x`);
    probes.push('/', '/thjonusta', '/admin', '/admin/books/pos/x', '/SHOP', '/Admin/Books/POS');
    const configs = [
      {}, { modules: { preset: 'vefur' } }, { modules: { preset: 'verslun' } },
      { modules: { preset: 'rekstur', pos: { enabled: false } } },
    ];
    for (const fc of configs) {
      const server = moduleState(resolved(fc).config);
      const client = normalizeModules(JSON.parse(JSON.stringify(moduleHandoff(server))));
      const drift = probes.filter((p) => routeDisabledIn(client, p) !== server.isDisabledRoute(p));
      expect([JSON.stringify(fc), drift]).toEqual([JSON.stringify(fc), []]);
    }
  });

  test('a missing or malformed hand-off reads as every module on', () => {
    for (const raw of [null, 'x', { routes: 'no', enabled: 3, disabledAdminViews: {} }]) {
      const s = normalizeModules(raw);
      expect(routeDisabledIn(s, '/shop')).toBe(false);
      expect(s.disabledAdminViews).toEqual([]);
      expect(s.preset).toBe('all');
    }
  });

  test('the hand-off cannot close its script element', () => {
    const s = moduleState(resolved().config);
    const tag = modulesScriptTag({ ...s, preset: '</script><!--' });
    expect(tag.startsWith('<script id="modules" type="application/json">')).toBe(true);
    expect(tag.slice(0, -'</script>'.length)).not.toMatch(/<\/|<!--/);
  });
});
