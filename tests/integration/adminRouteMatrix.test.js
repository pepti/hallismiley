'use strict';
// Every staff API route refuses a signed-in plain `user` and an anonymous
// caller. Modelled on icelandicstore's tests/integration/companyAdminIsolation.test.js
// (#416 G6, c05ce2bb) in harvest 2, 2026-09-26.
//
// The route list is READ from the source: every `app.use('/api/v1/admin…', router)`
// and `app.use('/api/v1/system', router)` mount in server/app.js, and every
// method + path on each router's own stack. A route added later is covered
// without touching this file; a mount this parser cannot read fails the sanity
// test instead of silently dropping out.
//
// Expected: a plain `user` gets 403 on every route (the outer guard in app.js,
// requireAuth + requireStaff on /api/v1/admin, and the routers' own gates);
// anonymous gets 401 (or 403 where a gate answers before authentication).
// Exemptions are listed in EXEMPT with the reason — none are silent.
const fs      = require('fs');
const path    = require('path');
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const modules = require('../../server/config/modules');
const { cleanTables, createTestRegularUser, getTestSessionCookie } = require('../helpers');

const APP_JS = path.join(__dirname, '../../server/app.js');
const STAFF_MOUNT = /^\/api\/v1\/(admin(\/[\w-]+)*|system)$/;

// Mounts that are staff-only in app.js, with the router they serve. Handles both
// `app.use('/x', fooRoutes)` (a `const fooRoutes = require('./routes/…')` above)
// and `app.use('/x', require('./routes/…'))`. Middleware-only lines (the write
// limiters, the outer guard) are not routers and are skipped by construction.
function staffMounts() {
  const src = fs.readFileSync(APP_JS, 'utf8');
  const named = new Map();
  for (const m of src.matchAll(/const\s+(?:\{\s*router:\s*)?(\w+)\s*\}?\s*=\s*require\('(\.\/routes\/[\w]+)'\)/g)) {
    named.set(m[1], m[2]);
  }
  const mounts = [];
  const re = /app\.use\(\s*'([^']+)'\s*,\s*(?:(\w+)|require\('(\.\/routes\/[\w]+)'\))\s*\)/g;
  for (const m of src.matchAll(re)) {
    const [, base, name, inline] = m;
    if (!STAFF_MOUNT.test(base)) continue;
    const file = inline || named.get(name);
    if (!file) continue;
    const mod = require(path.join(path.dirname(APP_JS), file));
    const router = mod && mod.stack ? mod : mod && mod.router;
    mounts.push({ base, file, router });
  }
  return mounts;
}

// `:id` → a dummy id; Express 5 optional groups `{…}` dropped; `*splat` → x.
function concretePath(p) {
  return p.replace(/\{[^}]*\}/g, '').replace(/:(\w+)/g, 'x0000000-dummy').replace(/\*\w*/g, 'x');
}

function staffRoutes() {
  const out = [];
  for (const { base, file, router } of staffMounts()) {
    if (!router || !Array.isArray(router.stack)) throw new Error(`${file} mounted at ${base} exports no router`);
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        if (typeof p !== 'string') throw new Error(`non-string route path under ${base}: update this test`);
        for (const method of Object.keys(layer.route.methods)) {
          if (method === '_all') continue;
          out.push({ method, url: (base + concretePath(p)).replace(/\/+$/, '') || '/' });
        }
      }
    }
  }
  return out;
}

// Deliberate exceptions, each with its reason. Keyed `METHOD url`.
const EXEMPT = new Map([
  // (none today — every staff route refuses both callers)
]);

// A module this instance switched off answers 404 for everyone at the module
// gate (config/modules.js moduleGate) before any auth runs — "absent", not a
// leak. Computed from the live config, so the engine (every module on) checks
// every route.
function moduleOff(url) {
  const owner = modules.ownerOf(url, 'api');
  return owner !== null && !modules.moduleSummary().enabled.includes(owner);
}

let userCookie;

beforeAll(async () => {
  await cleanTables();
  const userId = await createTestRegularUser();
  userCookie = await getTestSessionCookie(userId);
});

afterAll(async () => { await db.pool.end(); });

describe('the staff route matrix', () => {
  test('the route list is read from the routers (sanity: the big ones are in it)', () => {
    const mounts = staffMounts().map(m => m.base);
    expect(mounts).toEqual(expect.arrayContaining([
      '/api/v1/admin', '/api/v1/admin/shop', '/api/v1/admin/bookkeeping', '/api/v1/admin/roles',
      '/api/v1/admin/mcp-tokens', '/api/v1/admin/events', '/api/v1/system',
    ]));
    const urls = staffRoutes().map(r => `${r.method.toUpperCase()} ${r.url}`);
    expect(urls.length).toBeGreaterThan(150);
    expect(urls).toEqual(expect.arrayContaining([
      'GET /api/v1/admin/users', 'GET /api/v1/admin/bookkeeping/invoices', 'POST /api/v1/admin/shop/products',
    ]));
    // Every app.use of an admin path that names a routes file is accounted for.
    const src = fs.readFileSync(APP_JS, 'utf8');
    const declared = [...src.matchAll(/app\.use\(\s*'(\/api\/v1\/admin[^']*)'\s*,\s*(?:require\('\.\/routes\/|\w+Routes\b)/g)].map(m => m[1]);
    for (const base of declared) expect(mounts).toContain(base);
  });

  test('a signed-in plain user gets 403 on every staff route', async () => {
    const leaks = [];
    for (const { method, url } of staffRoutes()) {
      const key = `${method.toUpperCase()} ${url}`;
      if (EXEMPT.has(key) || moduleOff(url)) continue;
      const res = await request(app)[method](url).set('Cookie', userCookie).send({});
      if (res.status !== 403) leaks.push(`${key} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  }, 300000);

  test('an anonymous caller gets 401 (or 403) on every staff route', async () => {
    const leaks = [];
    for (const { method, url } of staffRoutes()) {
      const key = `${method.toUpperCase()} ${url}`;
      if (EXEMPT.has(key) || moduleOff(url)) continue;
      const res = await request(app)[method](url).send({});
      if (res.status !== 401 && res.status !== 403) leaks.push(`${key} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  }, 300000);
});
