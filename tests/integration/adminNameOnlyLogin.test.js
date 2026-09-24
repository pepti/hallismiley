// Name-only logins (harvested from icelandicstore #382/#397, 2026-09-24; Halli:
// "logins without email allowed"). An admin creates a customer login from a
// name alone: generated username (Icelandic letters transliterated), a
// generated password shown ONCE, a reserved <username>@noemail.invalid address
// that is never shown, searched, mailed or reset. A lost password is replaced
// by POST /admin/users/:id/new-password, which only ever works for such a
// mailbox-less, non-staff login.
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { createTestAdminUser, getTestSessionCookie, cleanTables } = require('../helpers');

let adminCookie;

const createNameOnly = (body = { display_name: 'Þórður Ólafsson' }) =>
  request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie).send({ no_email: true, ...body });
const login = (username, password) => request(app).post('/auth/login').send({ username, password });

beforeEach(async () => {
  await cleanTables();
  await createTestAdminUser();
  adminCookie = await getTestSessionCookie();
});

describe('create', () => {
  test('a name alone makes a login that signs in with the shown-once password', async () => {
    const res = await createNameOnly();
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body.noEmail).toBe(true);
    expect(res.body.username).toBe('thordurolafsson');
    expect(res.body.password).toMatch(/^[2-9A-HJ-NP-TV-Z]{5}(-[2-9A-HJ-NP-TV-Z]{5}){3}$/);
    expect(res.body.customer.email).toBeNull();

    const { rows } = await db.query('SELECT email, approval_status, password_reset_token FROM users WHERE username = $1', ['thordurolafsson']);
    expect(rows[0]).toEqual({ email: 'thordurolafsson@noemail.invalid', approval_status: 'approved', password_reset_token: null });

    const signIn = await login('thordurolafsson', res.body.password);
    expect(signIn.status).toBe(200);
  });

  test('a second person of the same name gets a suffixed username', async () => {
    await createNameOnly();
    expect((await createNameOnly()).body.username).toBe('thordurolafsson2');
  });

  test('without a name → 400', async () => {
    expect((await createNameOnly({ display_name: '' })).status).toBe(400);
  });

  test('a reserved placeholder address is refused as an email', async () => {
    const res = await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie)
      .send({ email: 'someone@noemail.invalid' });
    expect(res.status).toBe(400);
  });
});

describe('the placeholder is never an address', () => {
  test('lists read it as no email and never match it in a search', async () => {
    await createNameOnly();
    const customers = (await request(app).get('/api/v1/admin/customers').set('Cookie', adminCookie)).body.customers;
    expect(customers.find((c) => c.username === 'thordurolafsson').email).toBeNull();
    const hit = (await request(app).get('/api/v1/admin/customers?q=noemail').set('Cookie', adminCookie)).body.customers;
    expect(hit).toHaveLength(0);

    const users = (await request(app).get('/api/v1/admin/users?q=thordur').set('Cookie', adminCookie)).body.users;
    expect(users[0]).toEqual(expect.objectContaining({ email: null, no_email: true }));
    const none = (await request(app).get('/api/v1/admin/users?q=noemail.invalid').set('Cookie', adminCookie)).body.users;
    expect(none).toHaveLength(0);
  });

  test('forgot-password for the placeholder stamps nothing', async () => {
    await createNameOnly();
    const res = await request(app).post('/auth/forgot-password').send({ email: 'thordurolafsson@noemail.invalid' });
    expect(res.status).toBe(200);
    const { rows } = await db.query('SELECT password_reset_token FROM users WHERE username = $1', ['thordurolafsson']);
    expect(rows[0].password_reset_token).toBeNull();
  });

  test('the bulk welcome invite never counts it as a candidate', async () => {
    await createNameOnly();
    await db.query(`UPDATE users SET password_hash = NULL WHERE username = 'thordurolafsson'`);
    const res = await request(app).get('/api/v1/admin/customers/send-invites/preview').set('Cookie', adminCookie);
    expect(res.body.count).toBe(0);
  });
});

describe('POST /api/v1/admin/users/:id/new-password', () => {
  const newPassword = (id) => request(app).post(`/api/v1/admin/users/${id}/new-password`).set('Cookie', adminCookie);

  test('replaces a lost password once; the old one stops working and sessions end', async () => {
    const created = (await createNameOnly()).body;
    const id = created.customer.id;
    const theirCookie = await getTestSessionCookie(id);

    const res = await newPassword(id);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body.username).toBe('thordurolafsson');
    expect(res.body.password).not.toBe(created.password);

    expect((await login('thordurolafsson', created.password)).status).toBe(401);
    expect((await login('thordurolafsson', res.body.password)).status).toBe(200);
    expect((await request(app).get('/api/v1/users/me').set('Cookie', theirCookie)).status).toBe(401);
  });

  test('refused for a login that has its own mailbox', async () => {
    const r = await request(app).post('/api/v1/admin/customers').set('Cookie', adminCookie)
      .send({ email: 'real@example.is', display_name: 'Real' });
    expect((await newPassword(r.body.customer.id)).status).toBe(409);
  });

  test('refused for a staff account even if it carries a placeholder', async () => {
    const id = (await createNameOnly()).body.customer.id;
    await db.query(`UPDATE users SET role = 'moderator' WHERE id = $1`, [id]);
    expect((await newPassword(id)).status).toBe(409);
  });

  test('404 for an unknown user', async () => {
    expect((await newPassword('no-such-user')).status).toBe(404);
  });
});
