'use strict';

// PUT /api/v1/users/me/cookie-consent — the analytics-cookie choice on the
// account (users.cookie_consent, migration 128), carried on /auth/session so a
// signed-in user who already answered is not asked again in another browser.

const request = require('supertest');
const app     = require('../../server/app');
const {
  createTestAdminUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

let adminId;
let cookie;

beforeEach(async () => {
  await cleanTables();
  adminId = await createTestAdminUser();
  cookie  = await getTestSessionCookie(adminId);
});

const put = (body, c = cookie) =>
  request(app).put('/api/v1/users/me/cookie-consent').set('Cookie', c).send(body);
const sessionConsent = async (c = cookie) =>
  (await request(app).get('/auth/session').set('Cookie', c)).body.user.cookie_consent;

describe('PUT /api/v1/users/me/cookie-consent', () => {
  test('starts unanswered, and the answer rides on the session payload', async () => {
    expect(await sessionConsent()).toBeNull();

    let res = await put({ value: 'accepted' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cookie_consent: 'accepted' });
    expect(await sessionConsent()).toBe('accepted');

    res = await put({ value: 'declined' });
    expect(res.body).toEqual({ cookie_consent: 'declined' });
    expect(await sessionConsent()).toBe('declined');

    const me = await request(app).get('/api/v1/users/me').set('Cookie', cookie);
    expect(me.body.cookie_consent).toBe('declined');
  });

  test.each([[{}], [{ value: 'yes' }], [{ value: true }], [{ value: null }]])('rejects %j with 400', async (body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 400);
    expect(await sessionConsent()).toBeNull();
  });

  test('writes only the caller\'s own row', async () => {
    const otherId = await createTestRegularUser();
    const other = await getTestSessionCookie(otherId);
    await put({ value: 'accepted' });
    expect(await sessionConsent(other)).toBeNull();
  });

  test('needs a session', async () => {
    const res = await request(app).put('/api/v1/users/me/cookie-consent').send({ value: 'accepted' });
    expect(res.status).toBe(401);
  });
});
