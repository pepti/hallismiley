// /api/v1/system/changes must answer even when the self-update module is OFF.
//
// The rest of /api/v1/system is 404-gated on clientConfig.modules.selfUpdate
// (the base ships it off), but the "Latest updates" card on Monitoring is not
// part of self-update — it describes the running build, which every instance
// has. This pins the route's placement BEFORE that gate: an instance that has
// never heard of release channels still gets the card.
jest.mock('../../server/services/selfUpdateSettings', () => {
  const actual = jest.requireActual('../../server/services/selfUpdateSettings');
  return { ...actual, isEnabled: () => false };
});

const request = require('supertest');
const app     = require('../../server/app');
const { createTestAdminUser, getTestSessionCookie, cleanTables } = require('../helpers');

let adminCookie;

beforeAll(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie(await createTestAdminUser());
});

afterAll(async () => {
  await cleanTables();
});

describe('with self-update switched off', () => {
  test('/api/v1/system/version is 404 (the module gate)', async () => {
    const res = await request(app).get('/api/v1/system/version').set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  test('/api/v1/system/changes still answers an admin', async () => {
    const res = await request(app).get('/api/v1/system/changes').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual(expect.any(Array));
  });

  test('/api/v1/system/changes is still admin-only', async () => {
    const res = await request(app).get('/api/v1/system/changes');
    expect(res.status).toBe(401);
  });
});
