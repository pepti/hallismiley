// Module switches end to end (R4, 2026-09-24): `modules.preset` and
// `modules.<id>.enabled` in the client config decide which modules an
// instance HAS.
//
// Off must mean absent, the self-update switch's rule
// (selfUpdateDisabled.test.js): every API and upload prefix of the module 404s
// with the error envelope BEFORE auth, its pages render the not-found shell
// with a real 404 and noindex, its routes leave the sitemap, and its admin
// views leave the role editor. Core surfaces — and the modules still on —
// answer exactly as before.
//
// clientConfig resolves at require time, so each case loads a fresh app under
// the env it needs (the honest simulation: a switch is part of the instance
// contract, so changing it is a redeploy).
const request = require('supertest');
const {
  createTestAdminUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  let app;
  let tools;
  jest.isolateModules(() => {
    app = require('../../server/app');
    tools = require('../../server/mcp/tools/system');
  });
  return Promise.resolve(fn(app, tools)).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

const NOT_FOUND = { error: 'Not found', code: 404 };
const VEFUR = { CLIENT_CONFIG_MODULES_PRESET: 'vefur' };

let adminCookie;
beforeEach(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie(await createTestAdminUser());
});

describe('preset vefur — the core + news', () => {
  test('every API of a switched-off module 404s before auth, for anyone', async () => {
    await withEnv(VEFUR, async (app) => {
      const probes = [
        ['get',  '/api/v1/shop/products'],
        ['post', '/api/v1/shop/webhook'],           // the raw-body Stripe route, mounted before the gate would be too late
        ['get',  '/api/v1/admin/shop/products'],
        ['get',  '/api/v1/admin/customers'],
        ['get',  '/api/v1/admin/bookkeeping/invoices'],
        ['get',  '/api/v1/admin/bookkeeping/pos/day'],
        ['get',  '/api/v1/projects'],
        ['get',  '/api/v1/party/info'],
        ['get',  '/api/v1/content/halli_bio'],
        ['get',  '/api/v1/admin/handbok'],
        ['get',  '/api/v1/admin/markadur'],
        ['get',  '/api/v1/seller/me'],
        ['post', '/api/v1/seller-publish'],
        ['get',  '/assets/products/missing.jpg'],
        // Express routes ignore case, so the gate must too (invariant-reviewer).
        ['get',  '/API/V1/SHOP/products'],
        ['get',  '/api/v1/Shop/products'],
        ['get',  '/api/v1/PROJECTS'],
        ['post', '/api/v1/Party/photos'],
        ['get',  '/Assets/Products/missing.jpg'],
      ];
      for (const [method, path] of probes) {
        const anon = await request(app)[method](path);
        expect([path, anon.status, anon.body]).toEqual([path, 404, NOT_FOUND]);
        const admin = await request(app)[method](path).set('Cookie', adminCookie);
        expect([path, admin.status, admin.body]).toEqual([path, 404, NOT_FOUND]);
      }
    });
  });

  test('the core still answers', async () => {
    await withEnv(VEFUR, async (app) => {
      expect((await request(app).get('/api/v1/admin/leads').set('Cookie', adminCookie)).status).toBe(200);
      expect((await request(app).get('/api/v1/admin/users').set('Cookie', adminCookie)).status).toBe(200);
      expect((await request(app).get('/health')).status).toBe(200);
      // News is in every tier (Halli, 2026-09-24).
      expect((await request(app).get('/api/v1/news')).status).toBe(200);
      const page = await request(app).get('/is/thjonusta');
      expect(page.status).toBe(200);
      // hallismiley (engine-sync-4): a product that hides /thjonusta
      // (identity.surface.hiddenRoutes) serves it noindex — still a 200, which
      // is what this case is about. The engine should take the gate.
      const { isHiddenRoute } = require('../../server/config/publicSurface');
      const robots = isHiddenRoute('/thjonusta') ? 'noindex, nofollow' : 'index, follow';
      expect(page.text).toContain(`<meta name="robots" content="${robots}"`);
    });
  });

  test('a page of a switched-off module is the not-found shell: 404, noindex, the hand-off says why', async () => {
    await withEnv(VEFUR, async (app) => {
      for (const path of ['/is/shop', '/en/shop/some-product', '/is/admin/books/vat', '/is/solusvaedi', '/is/verkefni', '/is/SHOP', '/is/Verkefni/x']) {
        const res = await request(app).get(path);
        expect([path, res.status]).toEqual([path, 404]);
        expect(res.text).toContain('<meta name="robots" content="noindex, nofollow"');
        expect(res.text).toContain('<div id="app"');
      }
      const shell = await request(app).get('/is/shop');
      const json = /<script id="modules" type="application\/json">(.*?)<\/script>/.exec(shell.text);
      expect(json).not.toBeNull();
      const handoff = JSON.parse(json[1]);
      expect(handoff.preset).toBe('vefur');
      expect(handoff.enabled.shop).toBe(false);
      expect(handoff.routes['/shop']).toBe(false);
      expect(handoff.disabledAdminViews).toEqual(expect.arrayContaining(['products', 'books', 'pos', 'handbok']));
    });
  });

  test('the 404 page publishes nothing of the switched-off module: no detail row, no list, no route title', async () => {
    const db = require('../../server/config/database');
    await db.query(
      `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku)
       VALUES ('r4-leynivara', 'Leynivara R4', 'Lýsing sem má ekki sjást', 1000, 700, 3, 'SKU-R4')
       ON CONFLICT (slug) DO NOTHING`
    );
    await withEnv({}, async (app) => {
      // Control: with the shop on, SSR does publish the product.
      const on = await request(app).get('/is/shop/r4-leynivara');
      expect(on.status).toBe(200);
      expect(on.text).toContain('Leynivara R4');
    });
    await withEnv(VEFUR, async (app) => {
      const unknown = await request(app).get('/is/engin-slik-sida');
      const titleOf = (html) => /<title[^>]*>([^<]*)<\/title>/.exec(html)[1];
      for (const path of ['/is/shop/r4-leynivara', '/is/shop']) {
        const res = await request(app).get(path);
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('Leynivara R4');
        expect(res.text).not.toContain('crawler-content');
        expect(res.text).not.toContain('"@type":"Product"');
        expect(titleOf(res.text)).toBe(titleOf(unknown.text));
      }
    });
  });

  test('a switched-off module leaves the sitemap even when the product lists it in the nav', async () => {
    const env = {
      ...VEFUR,
      CLIENT_CONFIG_IDENTITY_SURFACE_NAV: JSON.stringify([
        { route: '/thjonusta', labelKey: 'nav.thjonusta' },
        { route: '/verkefni', labelKey: 'nav.verkefni' },
      ]),
      CLIENT_CONFIG_IDENTITY_SURFACE_HIDDEN_ROUTES: '[]',
    };
    await withEnv(env, async (app) => {
      const res = await request(app).get('/sitemap.xml');
      expect(res.status).toBe(200);
      expect(res.text).toContain('/thjonusta');
      expect(res.text).not.toMatch(/\/verkefni</);
    });
    // Control: the same identity with the module on does list it.
    await withEnv({ ...env, CLIENT_CONFIG_MODULES_PROJECTS_ENABLED: 'true' }, async (app) => {
      expect((await request(app).get('/sitemap.xml')).text).toMatch(/\/verkefni</);
    });
  });

  test('the role editor offers no view of a switched-off module', async () => {
    await withEnv(VEFUR, async (app) => {
      const res = await request(app).get('/api/v1/admin/roles').set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.grantableViews).toEqual(expect.arrayContaining(['leads', 'users', 'feedback']));
      for (const v of ['products', 'orders', 'books', 'invoices', 'pos', 'handbok', 'accounts', 'allaccounts']) {
        expect([v, res.body.grantableViews.includes(v)]).toEqual([v, false]);
      }
    });
  });

  test('the MCP environment_info tool reports the preset and the enabled set', async () => {
    await withEnv(VEFUR, async (_app, tools) => {
      const info = await tools.find((t) => t.name === 'environment_info').handler();
      // R5b added the contract and the admin's switched-off list.
      expect(info.modules).toEqual({ preset: 'vefur', enabled: ['news'], contract: ['news'], switched_off: [] });
    });
  });
});

describe('preset rekstur with the till switched off', () => {
  const ENV = { CLIENT_CONFIG_MODULES_PRESET: 'rekstur', CLIENT_CONFIG_MODULES_POS_ENABLED: 'false' };

  test('bókhald answers, the till under it does not', async () => {
    await withEnv(ENV, async (app) => {
      expect((await request(app).get('/api/v1/admin/bookkeeping/invoices').set('Cookie', adminCookie)).status).toBe(200);
      const till = await request(app).get('/api/v1/admin/bookkeeping/pos/day').set('Cookie', adminCookie);
      expect([till.status, till.body]).toEqual([404, NOT_FOUND]);
      expect((await request(app).get('/api/v1/shop/products')).status).toBe(200);
      expect((await request(app).get('/api/v1/projects')).status).toBe(404);
      expect((await request(app).get('/is/admin/books/pos')).status).toBe(404);
      expect((await request(app).get('/is/admin/books')).status).toBe(200);
    });
  });
});

describe('the default — every module, as before R4', () => {
  test('nothing is gated and the hand-off says so', async () => {
    // The ENGINE default, whatever this product's contract switches off
    // (rekstrarkerfid: party, signup): every catalogued module on, by env.
    await withEnv(Object.fromEntries(require('../../server/config/moduleCatalog').MODULE_IDS.map((id) => [require('../../server/config/clientConfig').envNameFor(['modules', id, 'enabled']), 'true'])), async (app) => {
      expect((await request(app).get('/api/v1/shop/products')).status).toBe(200);
      expect((await request(app).get('/api/v1/news')).status).toBe(200);
      expect((await request(app).get('/api/v1/admin/bookkeeping/invoices').set('Cookie', adminCookie)).status).toBe(200);
      const shell = await request(app).get('/is/shop');
      expect(shell.status).toBe(200);
      const handoff = JSON.parse(/<script id="modules" type="application\/json">(.*?)<\/script>/.exec(shell.text)[1]);
      expect(handoff.disabledAdminViews).toEqual([]);
      expect(Object.values(handoff.enabled).every(Boolean)).toBe(true);
    });
  });
});
