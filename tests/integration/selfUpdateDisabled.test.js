// The module flag: `modules.selfUpdate.enabled = false`.
//
// This is the switch the base (HalliProjects) ships OFF, so the engine carries
// the capability dormant and each fleet turns it on deliberately. Off must mean
// genuinely absent — 404, not 403. A 403 says "this exists and you may not have
// it", which on an instance where self-update was never provisioned is both a
// lie and a hint.
const request = require('supertest');
const {
  createTestAdminUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const DISABLED = { CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED: 'false' };

/**
 * Load a fresh app with the module switched off. clientConfig reads the
 * environment at require time, which is the honest simulation: the flag is part
 * of the instance contract, so changing it is a redeploy.
 */
function withDisabledModule(fn) {
  const saved = {};
  for (const [k, v] of Object.entries(DISABLED)) { saved[k] = process.env[k]; process.env[k] = v; }
  let app;
  jest.isolateModules(() => { app = require('../../server/app'); });
  return Promise.resolve(fn(app)).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

let adminCookie;
beforeEach(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie(await createTestAdminUser());
});

describe('with the module switched off', () => {
  const paths = [
    ['get',   '/api/v1/system/version'],
    ['get',   '/api/v1/system/updates'],
    ['patch', '/api/v1/system/settings'],
    ['post',  '/api/v1/system/updates/1/apply'],
    ['post',  '/api/v1/system/updates/1/rollback'],
  ];

  test('every endpoint 404s for an admin — the module is absent, not forbidden', async () => {
    await withDisabledModule(async (app) => {
      for (const [method, path] of paths) {
        const res = await request(app)[method](path).set('Cookie', adminCookie);
        expect([path, res.status]).toEqual([path, 404]);
        expect(res.body).toEqual({ error: 'Not found', code: 404 });
      }
    });
  });

  test('the 404 comes BEFORE authentication — an anonymous probe learns nothing either', async () => {
    await withDisabledModule(async (app) => {
      const res = await request(app).get('/api/v1/system/version');
      expect(res.status).toBe(404);
      // Not 401: a 401 would confirm the route exists behind a login.
      expect(res.body.code).toBe(404);
    });
  });

  test('the update checker does not start', async () => {
    await withDisabledModule(() => {
      let checker;
      const messages = [];
      const log = { info: m => messages.push(m), warn() {}, error() {} };
      jest.isolateModules(() => { checker = require('../../server/services/updateChecker'); });
      expect(checker.startUpdateChecker({ log })).toBeNull();
      expect(messages.join(' ')).toMatch(/switched off/);
    });
  });
});

describe('with the module switched on (env override)', () => {
  // The BASE ships the module off and carries no config/client.json, so
  // switching it on for this test is an explicit env override — the same
  // mechanism an instance uses.
  test('the endpoints exist again', async () => {
    const saved = process.env.CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED;
    process.env.CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED = 'true';
    try {
      let app;
      jest.isolateModules(() => { app = require('../../server/app'); });
      const res = await request(app).get('/api/v1/system/version').set('Cookie', adminCookie);
      expect(res.status).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED;
      else process.env.CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED = saved;
    }
  });
});
