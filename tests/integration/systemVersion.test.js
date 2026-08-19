// Integration tests for GET /api/v1/system/version — the instance's answer to
// "what exactly am I running?". Admin-gated on purpose: "which version" is also
// "which published CVEs apply to me", so it is never public.
const request = require('supertest');
// Base ships the module OFF — switch it on before app require (env is read
// at require time), the same way an instance would.
process.env.CLIENT_CONFIG_MODULES_SELF_UPDATE_ENABLED = 'true';
const app     = require('../../server/app');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const URL = '/api/v1/system/version';

let adminCookie, userCookie;

beforeEach(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie(await createTestAdminUser());
  userCookie  = await getTestSessionCookie(await createTestRegularUser());
});

describe('GET /api/v1/system/version — access', () => {
  test('anonymous callers get 401 in the standard envelope', async () => {
    const res = await request(app).get(URL);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', code: 401 });
  });

  test('a signed-in non-admin gets 403 in the standard envelope', async () => {
    const res = await request(app).get(URL).set('Cookie', userCookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden', code: 403 });
  });

  test('an admin gets the build identity', async () => {
    const res = await request(app).get(URL).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.build).toEqual({
      version: expect.any(String),
      gitSha:  expect.any(String),
      builtAt: null,          // no stamp in a test checkout
      channel: expect.any(String),
    });
  });
});

describe('GET /api/v1/system/version — payload', () => {
  test('an unstamped checkout reports the dev identity rather than guessing', async () => {
    const res = await request(app).get(URL).set('Cookie', adminCookie);
    expect(res.body.build.version).toBe('dev');
    expect(res.body.build.channel).toBe('dev');
  });

  test('reports the self-update mode and channel this instance is configured for', async () => {
    const res = await request(app).get(URL).set('Cookie', adminCookie);
    expect(res.body.selfUpdate).toEqual({
      mode:         'managed',
      channel:      'stable',
      manifestHost: 'releases.orangesmiley.is',
    });
  });

  test('exposes the manifest HOST, never the full URL', async () => {
    const res = await request(app).get(URL).set('Cookie', adminCookie);
    expect(JSON.stringify(res.body)).not.toContain('https://');
    expect(res.body.selfUpdate.manifestHost).not.toContain('/');
  });

  test('leaks nothing else about the instance', async () => {
    const res = await request(app).get(URL).set('Cookie', adminCookie);
    expect(Object.keys(res.body).sort()).toEqual(['build', 'selfUpdate']);
  });
});
