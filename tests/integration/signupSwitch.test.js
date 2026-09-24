'use strict';

// Public signup switched off (the `signup` module, R2b — rekstrarkerfi.is, the
// shop window, runs it off: staff sign in, nobody signs up). Off must mean
// absent, like every module: the signup API and its availability checks 404
// before auth, /signup is the not-found shell, the hand-off tells the SPA —
// and signing IN is untouched. The social-login half (no NEW account from a
// first Google sign-in) is in auth.google.test.js, next to the flow it gates.
const request = require('supertest');
const { createTestAdminUser, cleanTables } = require('../helpers');

const NOT_FOUND = { error: 'Not found', code: 404 };

function withSignupOff(fn) {
  const saved = process.env.CLIENT_CONFIG_MODULES_SIGNUP_ENABLED;
  process.env.CLIENT_CONFIG_MODULES_SIGNUP_ENABLED = 'false';
  let app;
  jest.isolateModules(() => { app = require('../../server/app'); });
  return Promise.resolve(fn(app)).finally(() => {
    if (saved === undefined) delete process.env.CLIENT_CONFIG_MODULES_SIGNUP_ENABLED;
    else process.env.CLIENT_CONFIG_MODULES_SIGNUP_ENABLED = saved;
  });
}

beforeEach(async () => {
  await cleanTables();
  await createTestAdminUser();
});

describe('signup switched off', () => {
  test('the signup API and its availability checks are absent, whatever the case of the path', async () => {
    await withSignupOff(async (app) => {
      const probes = [
        ['post', '/auth/signup', { username: 'nyr', email: 'nyr@example.com', password: 'Str0ng!Passw0rd' }],
        ['get', '/auth/check-username/nyr'],
        ['get', '/auth/check-email/nyr@example.com'],
        ['post', '/AUTH/Signup', {}],
      ];
      for (const [method, path, body] of probes) {
        const res = await request(app)[method](path).send(body || undefined);
        expect([path, res.status, res.body]).toEqual([path, 404, NOT_FOUND]);
      }
    });
  });

  test('/signup is the not-found shell, noindex, and the hand-off says signup is off', async () => {
    await withSignupOff(async (app) => {
      const res = await request(app).get('/is/signup');
      expect(res.status).toBe(404);
      expect(res.text).toContain('<meta name="robots" content="noindex, nofollow"');
      const handoff = JSON.parse(/<script id="modules" type="application\/json">(.*?)<\/script>/.exec(res.text)[1]);
      expect(handoff.enabled.signup).toBe(false);
      expect(handoff.routes['/signup']).toBe(false);
    });
  });

  test('signing in, signing out and the password reset are untouched', async () => {
    await withSignupOff(async (app) => {
      const login = await request(app).post('/auth/login')
        .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
      expect(login.status).toBe(200);
      expect((await request(app).post('/auth/forgot-password').send({ email: 'nobody@example.com' })).status).not.toBe(404);
      expect((await request(app).get('/auth/session')).status).not.toBe(404);
    });
  });
});

describe('signup on (the engine default)', () => {
  test('the API answers', async () => {
    const saved = process.env.CLIENT_CONFIG_MODULES_SIGNUP_ENABLED;
    process.env.CLIENT_CONFIG_MODULES_SIGNUP_ENABLED = 'true';
    let app;
    jest.isolateModules(() => { app = require('../../server/app'); });
    try {
      expect((await request(app).get('/auth/check-username/nyr')).status).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.CLIENT_CONFIG_MODULES_SIGNUP_ENABLED;
      else process.env.CLIENT_CONFIG_MODULES_SIGNUP_ENABLED = saved;
    }
  });
});
