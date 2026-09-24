'use strict';

// PUT /api/v1/users/me/page-width — the per-user, per-page admin width
// (sidebar width icon → Síðubreidd; users.page_widths, migration 125).

const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
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
  request(app).put('/api/v1/users/me/page-width').set('Cookie', c).send(body);

const stored = async (id = adminId) =>
  (await db.query('SELECT page_widths FROM users WHERE id = $1', [id])).rows[0].page_widths;

describe('PUT /api/v1/users/me/page-width', () => {
  test('saves a width per page, and the session payload carries it', async () => {
    let res = await put({ path: '/admin/shop/orders', width: 'full' });
    expect(res.status).toBe(200);
    expect(res.body.page_widths).toEqual({ '/admin/shop/orders': 'full' });

    res = await put({ path: '/admin/shop/orders/:id', width: 'wide' });
    expect(res.status).toBe(200);
    expect(await stored()).toEqual({ '/admin/shop/orders': 'full', '/admin/shop/orders/:id': 'wide' });

    const session = await request(app).get('/auth/session').set('Cookie', cookie);
    expect(session.body.user.page_widths).toEqual({
      '/admin/shop/orders': 'full', '/admin/shop/orders/:id': 'wide',
    });
  });

  test('overwrites an existing page and null resets it to the page default', async () => {
    await put({ path: '/admin/shop/orders', width: 'full' });
    await put({ path: '/admin/shop/orders', width: 'normal' });
    expect(await stored()).toEqual({ '/admin/shop/orders': 'normal' });

    const res = await put({ path: '/admin/shop/orders', width: null });
    expect(res.status).toBe(200);
    expect(res.body.page_widths).toEqual({});
    expect(await stored()).toEqual({});
  });

  test('a new account starts with an empty map', async () => {
    const res = await request(app).get('/api/v1/users/me').set('Cookie', cookie);
    expect(res.body.page_widths).toEqual({});
  });

  test.each([
    [{ path: '/admin/shop/orders', width: 'huge' }],
    [{ path: '/admin/shop/orders' }],
    [{ path: '/admin/shop/orders', width: 1 }],
  ])('rejects a bad width %j with 400', async (body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 400);
    expect(await stored()).toEqual({});
  });

  test.each([
    '/shop/cart',
    'admin/shop/orders',
    '/admin/Shop',
    '/admin/shop/../users',
    '/admin/' + 'a'.repeat(130),
    '',
  ])('rejects a bad page key %j with 400', async (path) => {
    const res = await put({ path, width: 'wide' });
    expect(res.status).toBe(400);
    expect(await stored()).toEqual({});
  });

  test('refuses a new page once 100 are saved, but still overwrites a saved one', async () => {
    const full = {};
    for (let i = 0; i < 100; i++) full[`/admin/p${i}`] = 'wide';
    await db.query('UPDATE users SET page_widths = $1 WHERE id = $2', [full, adminId]);

    let res = await put({ path: '/admin/one-more', width: 'wide' });
    expect(res.status).toBe(400);

    res = await put({ path: '/admin/p7', width: 'full' });
    expect(res.status).toBe(200);
    expect(res.body.page_widths['/admin/p7']).toBe('full');
  });

  test('writes only the caller\'s own row', async () => {
    const otherId = await createTestRegularUser();
    await put({ path: '/admin/shop/orders', width: 'full' });
    expect(await stored(otherId)).toEqual({});
  });

  test('"*" is the all-pages width: saving it replaces every per-page choice', async () => {
    await put({ path: '/admin/shop/orders', width: 'full' });
    await put({ path: '/admin/shop/import', width: 'normal' });

    let res = await put({ path: '*', width: 'wide' });
    expect(res.status).toBe(200);
    expect(res.body.page_widths).toEqual({ '*': 'wide' });

    // A page can still differ afterwards.
    await put({ path: '/admin/shop/orders', width: 'normal' });
    expect(await stored()).toEqual({ '*': 'wide', '/admin/shop/orders': 'normal' });

    // null clears only the all-pages width.
    res = await put({ path: '*', width: null });
    expect(res.status).toBe(200);
    expect(await stored()).toEqual({ '/admin/shop/orders': 'normal' });

    const session = await request(app).get('/auth/session').set('Cookie', cookie);
    expect(session.body.user.page_widths).toEqual({ '/admin/shop/orders': 'normal' });
  });

  test('"*" still validates the width, and "**" is not a key', async () => {
    expect((await put({ path: '*', width: 'huge' })).status).toBe(400);
    expect((await put({ path: '**', width: 'wide' })).status).toBe(400);
    expect((await put({ path: '/admin/*', width: 'wide' })).status).toBe(400);
    expect(await stored()).toEqual({});
  });

  test('needs a session', async () => {
    const res = await request(app).put('/api/v1/users/me/page-width')
      .send({ path: '/admin/shop/orders', width: 'full' });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/v1/users/me/page-width-motion', () => {
  const putMotion = (body, c = cookie) =>
    request(app).put('/api/v1/users/me/page-width-motion').set('Cookie', c).send(body);
  const motion = async () =>
    (await request(app).get('/auth/session').set('Cookie', cookie)).body.user.page_width_motion;

  test('is on by default and round-trips on the session payload', async () => {
    expect(await motion()).toBe(true);
    let res = await putMotion({ on: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ page_width_motion: false });
    expect(await motion()).toBe(false);
    res = await putMotion({ on: true });
    expect(res.body).toEqual({ page_width_motion: true });
    expect(await motion()).toBe(true);
  });

  test.each([[{}], [{ on: 'false' }], [{ on: 0 }], [{ on: null }]])('rejects %j with 400', async (body) => {
    const res = await putMotion(body);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 400);
    expect(await motion()).toBe(true);
  });

  test('"Nota á allar síður" does not reset it', async () => {
    await putMotion({ on: false });
    await put({ path: '*', width: 'wide' });
    expect(await motion()).toBe(false);
  });

  test('needs a session', async () => {
    const res = await request(app).put('/api/v1/users/me/page-width-motion').send({ on: false });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/v1/users/me/aside-width', () => {
  const putAside = (body, c = cookie) =>
    request(app).put('/api/v1/users/me/aside-width').set('Cookie', c).send(body);
  const asides = async () =>
    (await db.query('SELECT aside_widths FROM users WHERE id = $1', [adminId])).rows[0].aside_widths;

  test('saves per page into its own map and rides on the session payload', async () => {
    let res = await putAside({ path: '/admin/shop/orders/:id', width: 'wide' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aside_widths: { '/admin/shop/orders/:id': 'wide' } });
    await put({ path: '/admin/shop/orders/:id', width: 'full' });
    expect(await asides()).toEqual({ '/admin/shop/orders/:id': 'wide' });
    expect(await stored()).toEqual({ '/admin/shop/orders/:id': 'full' });

    const session = await request(app).get('/auth/session').set('Cookie', cookie);
    expect(session.body.user.aside_widths).toEqual({ '/admin/shop/orders/:id': 'wide' });

    res = await putAside({ path: '/admin/shop/orders/:id', width: null });
    expect(res.body).toEqual({ aside_widths: {} });
  });

  test('"*" replaces the map; the page-width "all pages" leaves it alone', async () => {
    await putAside({ path: '/admin/accounts/company/:companyid', width: 'medium' });
    await putAside({ path: '*', width: 'narrow' });
    expect(await asides()).toEqual({ '*': 'narrow' });
    await put({ path: '*', width: 'wide' });
    expect(await asides()).toEqual({ '*': 'narrow' });
  });

  test.each([
    [{ path: '/admin/shop/orders/:id', width: 'full' }],
    [{ path: '/admin/shop/orders/:id', width: 'normal' }],
    [{ path: '/shop/cart', width: 'wide' }],
    [{ width: 'wide' }],
  ])('rejects %j with 400', async (body) => {
    const res = await putAside(body);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 400);
    expect(await asides()).toEqual({});
  });

  test('needs a session', async () => {
    const res = await request(app).put('/api/v1/users/me/aside-width')
      .send({ path: '/admin/shop/orders/:id', width: 'wide' });
    expect(res.status).toBe(401);
  });
});
