// "Latest updates" — GET /api/v1/system/changes (ported from icelandicstore, ice #209).
//
// The changes a build carries, stamped into server/changes.json on the build
// host by server/scripts/generate-changes.js. Backs the Admin → Monitoring
// card that lets an admin see a fix arrive instead of asking. Same admin-only
// gate as /version, for the same reason: the list names commits.
//
// server/changes.json is gitignored and absent in the test environment, so
// the list is empty here; the shape and the gate are what is under test.
const request = require('supertest');
const app     = require('../../server/app');
const {
  createTestAdminUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

let adminCookie, userCookie;

beforeAll(async () => {
  await cleanTables();
  const adminId = await createTestAdminUser();
  const userId  = await createTestRegularUser();
  adminCookie = await getTestSessionCookie(adminId);
  userCookie  = await getTestSessionCookie(userId);
});

afterAll(async () => {
  await cleanTables();
});

// Skipped as a whole where self-update is switched off (modules.selfUpdate
// .enabled = false in the client config) or the feature is hidden on this
// product — see tests/lib/featureGate.js. Shadows the global.
const { describeForSpec } = require('../lib/featureGate');
const describe = describeForSpec(__filename);

describe('GET /api/v1/system/changes', () => {
  test('returns build identity plus a change list to an admin', async () => {
    const res = await request(app)
      .get('/api/v1/system/changes')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      gitSha:  expect.any(String),
      stamped: expect.any(Boolean),
      changes: expect.any(Array),
    }));
    // A dev checkout has no build stamp: builtAt is null there, a string on a build.
    expect(res.body.builtAt === null || typeof res.body.builtAt === 'string').toBe(true);
    for (const c of res.body.changes) {
      expect(c).toEqual(expect.objectContaining({ sha: expect.any(String), date: expect.any(String), subject: expect.any(String) }));
      expect(c.pr === null || Number.isInteger(c.pr)).toBe(true);
    }
  });

  test('is refused to a signed-in non-admin', async () => {
    const res = await request(app)
      .get('/api/v1/system/changes')
      .set('Cookie', userCookie);

    expect(res.status).toBe(403);
    expect(res.body.changes).toBeUndefined();
  });

  test('is refused to an anonymous caller', async () => {
    const res = await request(app).get('/api/v1/system/changes');

    expect(res.status).toBe(401);
    expect(res.body.changes).toBeUndefined();
  });
});

describe('server/config/version.js changes', () => {
  test('is a frozen array — the stamp cannot be edited at runtime', () => {
    const version = require('../../server/config/version');
    expect(Array.isArray(version.changes)).toBe(true);
    expect(Object.isFrozen(version.changes)).toBe(true);
  });

  test('buildInfo keeps its shape — the self-update checker reads it', () => {
    const { buildInfo } = require('../../server/config/version');
    expect(Object.keys(buildInfo).sort()).toEqual(['builtAt', 'channel', 'gitSha', 'version']);
  });
});
