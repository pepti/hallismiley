'use strict';

// MCP write tools (R5b, 2026-09-24): set_update_settings, set_module and
// file_feature_request. The scope double-gate (token scopes ⊆ the stack's
// MCP_ALLOWED_SCOPES ceiling), each tool going through the SAME service as
// the admin screens, the module switch's contract ceiling, and a switch
// taking effect at once — then surviving a restart through app_settings.
process.env.MCP_ENABLED = 'true';

const request = require('supertest');
const app = require('../../server/app');
const db = require('../../server/config/database');
const McpToken = require('../../server/models/McpToken');
const modules = require('../../server/config/modules');
const { createTestAdminUser, getTestSessionCookie, cleanTables } = require('../helpers');

let adminId, adminCookie, writeToken, readToken;

const rpc = (appInstance, bearer, body) => request(appInstance).post('/api/v1/mcp').set('Authorization', `Bearer ${bearer}`).send(body);
const call = (name, args, { appInstance = app, bearer = writeToken } = {}) =>
  rpc(appInstance, bearer, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const payload = (res) => JSON.parse(res.body.result.content[0].text);

async function clearSettings() {
  await db.query(`DELETE FROM app_settings WHERE key = $1 OR key LIKE 'selfupdate.%'`, [modules.ADMIN_OFF_KEY]);
}

/** A fresh app under `env` (the contract is resolved at require time). */
function withApp(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  let fresh; let freshModules;
  jest.isolateModules(() => {
    fresh = require('../../server/app');
    freshModules = require('../../server/config/modules');
  });
  return Promise.resolve(fn(fresh, freshModules)).finally(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
}

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE mcp_tokens, change_request_batches RESTART IDENTITY CASCADE');
  await clearSettings();
  modules.resetAdminSwitchesForTests();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  writeToken = (await McpToken.create({ userId: adminId, name: 'writer', scopes: ['read', 'write'] })).token;
  readToken = (await McpToken.create({ userId: adminId, name: 'reader', scopes: ['read'] })).token;
  process.env.MCP_ALLOWED_SCOPES = 'read,write';
});

afterEach(async () => {
  modules.resetAdminSwitchesForTests();
  await clearSettings();
});

afterAll(() => { delete process.env.MCP_ALLOWED_SCOPES; });

describe('the scope double-gate', () => {
  const WRITE_TOOLS = ['set_update_settings', 'set_module', 'file_feature_request'];

  test('a write token on a write stack lists the write tools', async () => {
    const res = await rpc(app, writeToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.body.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(WRITE_TOOLS));
  });

  test('a read token, or a read-only stack, neither lists nor runs them', async () => {
    const asReader = await rpc(app, readToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(asReader.body.result.tools.map((t) => t.name).filter((n) => WRITE_TOOLS.includes(n))).toEqual([]);
    const refused = await call('set_module', { module: 'shop', enabled: false }, { bearer: readToken });
    expect(refused.body.result.isError).toBe(true);

    process.env.MCP_ALLOWED_SCOPES = 'read';
    const ceiling = await call('set_module', { module: 'shop', enabled: false });
    expect(ceiling.body.result.isError).toBe(true);
    expect(payload(ceiling).error).toMatch(/Unknown tool/);
    expect((await request(app).get('/api/v1/shop/products')).status).toBe(200);
  });
});

describe('set_module', () => {
  test('switches a contracted module off at once, and back on', async () => {
    expect((await request(app).get('/api/v1/shop/products')).status).toBe(200);
    const off = await call('set_module', { module: 'shop', enabled: false });
    expect(off.body.result.isError).toBeUndefined();
    expect(payload(off).modules.switched_off).toEqual(['shop']);
    expect(payload(off).modules.enabled).not.toContain('shop');

    expect((await request(app).get('/api/v1/shop/products')).status).toBe(404);
    const page = await request(app).get('/is/shop');
    expect(page.status).toBe(404);
    const roles = await request(app).get('/api/v1/admin/roles').set('Cookie', adminCookie);
    expect(roles.body.grantableViews).not.toContain('products');

    const info = payload(await call('environment_info', {}));
    expect(info.modules.switched_off).toEqual(['shop']);

    const on = await call('set_module', { module: 'shop', enabled: true });
    expect(payload(on).modules.switched_off).toEqual([]);
    expect((await request(app).get('/api/v1/shop/products')).status).toBe(200);
  });

  test('the switch survives a restart through app_settings', async () => {
    await call('set_module', { module: 'news', enabled: false });
    const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [modules.ADMIN_OFF_KEY]);
    expect(rows[0].value).toEqual(['news']);
    await withApp({}, async (fresh, freshModules) => {
      // A fresh process: the contract alone until the boot step loads layer 2.
      expect((await request(fresh).get('/api/v1/news')).status).toBe(200);
      await freshModules.loadAdminSwitches();
      expect((await request(fresh).get('/api/v1/news')).status).toBe(404);
    });
  });

  test('never beyond the contract: a module the tier leaves out cannot be switched on', async () => {
    await withApp({ CLIENT_CONFIG_MODULES_PRESET: 'vefur' }, async (fresh) => {
      const res = await call('set_module', { module: 'books', enabled: true }, { appInstance: fresh });
      expect(res.body.result.isError).toBe(true);
      expect(payload(res).error).toMatch(/not in this instance's contract/);
      expect((await request(fresh).get('/api/v1/admin/bookkeeping/invoices').set('Cookie', adminCookie)).status).toBe(404);
    });
  });

  test('a stored list naming a module outside the contract is ignored at load', async () => {
    await db.query(`INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)`, [modules.ADMIN_OFF_KEY, JSON.stringify(['books', 'nope', 'news'])]);
    await withApp({ CLIENT_CONFIG_MODULES_PRESET: 'vefur' }, async (fresh, freshModules) => {
      const summary = await freshModules.loadAdminSwitches();
      expect(summary.switched_off).toEqual(['news']);
    });
  });

  test('two switches in flight at once both land (serialised, re-read under a row lock)', async () => {
    const [a, b] = await Promise.all([
      call('set_module', { module: 'news', enabled: false }),
      request(app).patch('/api/v1/admin/modules/party').set('Cookie', adminCookie).send({ enabled: false }),
    ]);
    expect(a.body.result.isError).toBeUndefined();
    expect(b.status).toBe(200);
    const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [modules.ADMIN_OFF_KEY]);
    expect(rows[0].value).toEqual(['news', 'party']);
    expect(modules.moduleSummary().switched_off).toEqual(['news', 'party']);
  });

  test('a switch never erases what another process stored (it re-reads the row)', async () => {
    await db.query(`INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)`, [modules.ADMIN_OFF_KEY, JSON.stringify(['bio'])]);
    // This process never loaded it (as if its boot load had failed).
    const res = payload(await call('set_module', { module: 'news', enabled: false }));
    expect(res.modules.switched_off).toEqual(['news', 'bio']); // catalogue order
    const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [modules.ADMIN_OFF_KEY]);
    expect(rows[0].value).toEqual(['bio', 'news']);
  });

  test('an unknown module is refused by the schema', async () => {
    const res = await call('set_module', { module: 'crm', enabled: false });
    expect(res.body.result.isError).toBe(true);
  });
});

describe('set_update_settings', () => {
  test('refused on a managed instance (the engine default)', async () => {
    const res = await call('set_update_settings', { channel: 'canary' });
    expect(res.body.result.isError).toBe(true);
    expect(payload(res).error).toMatch(/managed by Orange Smiley/);
  });

  test('on a manual instance: channel, mode and a merged window, through the admin screen\'s rules', async () => {
    await withApp({ CLIENT_CONFIG_MODULES_SELF_UPDATE_MODE: 'manual' }, async (fresh) => {
      const res = await call('set_update_settings', { channel: 'canary', mode: 'auto', window_from_hour: 1, window_to_hour: 4 }, { appInstance: fresh });
      expect(res.body.result.isError).toBeUndefined();
      const out = payload(res);
      expect(out).toMatchObject({ mode: 'auto', channel: 'canary' });
      expect(out.maintenanceWindow).toMatchObject({ fromHour: 1, toHour: 4, days: ['tue', 'wed', 'thu'] });

      // The admin screen reads the same rows.
      const screen = await request(fresh).get('/api/v1/system/version').set('Cookie', adminCookie);
      expect(screen.body.selfUpdate).toMatchObject({ mode: 'auto', channel: 'canary' });
      const { rows } = await db.query(`SELECT key FROM app_settings WHERE key LIKE 'selfupdate.%' ORDER BY key`);
      expect(rows.map((r) => r.key)).toEqual(['selfupdate.channel', 'selfupdate.maintenance_window', 'selfupdate.mode']);

      const bad = await call('set_update_settings', { window_days: 'someday' }, { appInstance: fresh });
      expect(payload(bad).error).toMatch(/day keys/);
      const zero = await call('set_update_settings', { window_from_hour: 4, window_to_hour: 4 }, { appInstance: fresh });
      expect(payload(zero).error).toMatch(/zero-length/);
      const empty = await call('set_update_settings', {}, { appInstance: fresh });
      expect(payload(empty).error).toMatch(/Nothing to update/);
    });
  });
});

describe('file_feature_request', () => {
  test('lands in the change-request inbox, attributed to the token owner', async () => {
    const res = await call('file_feature_request', {
      title: 'Birgðatalning í lok mánaðar',
      description: 'Við þurfum að telja lagerinn í lok hvers mánaðar og bera saman við bókhaldið.',
      page: '/admin/books',
    });
    expect(res.body.result.isError).toBeUndefined();
    const out = payload(res);
    expect(out).toMatchObject({ status: 'open', inbox: '/admin/feedback' });

    const { rows } = await db.query(
      `SELECT r.note, r.page_url, r.page_label, b.submitter_user_id, b.user_agent
         FROM change_requests r JOIN change_request_batches b ON b.id = r.batch_id WHERE r.id = $1`, [out.id]);
    expect(rows[0].note).toBe('Birgðatalning í lok mánaðar\n\nVið þurfum að telja lagerinn í lok hvers mánaðar og bera saman við bókhaldið.');
    expect(rows[0]).toMatchObject({ page_url: '/admin/books', page_label: 'Claude (MCP): /admin/books', submitter_user_id: adminId, user_agent: 'mcp:writer' });
  });

  test('on a production stack it follows the change-request switch, like the widget', async () => {
    const saved = process.env.APP_ENV;
    process.env.APP_ENV = 'production';
    try {
      const closed = await call('file_feature_request', { title: 't', description: 'd' });
      expect(payload(closed).error).toMatch(/switched off/);
      await db.query(`INSERT INTO app_settings (key, value) VALUES ('change_requests.enabled', 'true'::jsonb)
                      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      const open = await call('file_feature_request', { title: 't', description: 'd' });
      expect(open.body.result.isError).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = saved;
      await db.query(`DELETE FROM app_settings WHERE key = 'change_requests.enabled'`);
    }
  });

  test('length limits hold', async () => {
    expect(payload(await call('file_feature_request', { title: 'x'.repeat(201), description: 'y' })).error).toMatch(/title/);
    expect(payload(await call('file_feature_request', { title: 't', description: 'y'.repeat(4000) })).error).toMatch(/4000/);
    expect(payload(await call('file_feature_request', { title: '   ', description: 'y' })).error).toMatch(/title/);
  });
});

describe('the admin screen: /api/v1/admin/modules (the same rule, without Claude)', () => {
  test('lists the contract and what is on; an admin switches a module off and back on', async () => {
    const list = await request(app).get('/api/v1/admin/modules').set('Cookie', adminCookie);
    expect(list.status).toBe(200);
    expect(list.body.preset).toBe('all');
    expect(list.body.modules.find((m) => m.id === 'shop')).toEqual({ id: 'shop', contract: true, enabled: true });

    const off = await request(app).patch('/api/v1/admin/modules/shop').set('Cookie', adminCookie).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.modules.find((m) => m.id === 'shop').enabled).toBe(false);
    expect((await request(app).get('/api/v1/shop/products')).status).toBe(404);
    // What Claude sees agrees.
    expect(payload(await call('environment_info', {})).modules.switched_off).toEqual(['shop']);

    await request(app).patch('/api/v1/admin/modules/shop').set('Cookie', adminCookie).send({ enabled: true });
    expect((await request(app).get('/api/v1/shop/products')).status).toBe(200);
  });

  test('refuses a non-admin, a non-boolean, and a module outside the contract', async () => {
    expect((await request(app).get('/api/v1/admin/modules')).status).toBe(401);
    const { createTestRegularUser } = require('../helpers');
    const userCookie = await getTestSessionCookie(await createTestRegularUser());
    expect((await request(app).get('/api/v1/admin/modules').set('Cookie', userCookie)).status).toBe(403);
    expect((await request(app).patch('/api/v1/admin/modules/shop').set('Cookie', userCookie).send({ enabled: false })).status).toBe(403);

    const notBool = await request(app).patch('/api/v1/admin/modules/shop').set('Cookie', adminCookie).send({ enabled: 'no' });
    expect(notBool.status).toBe(400);
    expect(notBool.body).toEqual({ error: 'enabled must be a boolean', code: 400 });

    await withApp({ CLIENT_CONFIG_MODULES_PRESET: 'vefur' }, async (fresh) => {
      const res = await request(fresh).patch('/api/v1/admin/modules/books').set('Cookie', adminCookie).send({ enabled: true });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not in this instance's contract/);
      const list = await request(fresh).get('/api/v1/admin/modules').set('Cookie', adminCookie);
      expect(list.body.modules.find((m) => m.id === 'books')).toEqual({ id: 'books', contract: false, enabled: false });
    });
  });
});
