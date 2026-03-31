const request = require('supertest');
const app     = require('../server/app');
const db      = require('../server/config/database');
const { cleanTables, createTestAdminUser } = require('./helpers');

beforeEach(async () => {
  await cleanTables();
  await createTestAdminUser();
});

afterAll(async () => {
  await db.pool.end();
});

// ── POST /auth/login ──────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  test('valid credentials return user info and set session cookie', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: {
        username: process.env.ADMIN_USERNAME,
        role:     'admin',
      },
    });
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('auth_session='))).toBe(true);
  });

  test('wrong password returns 401 with generic message', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('wrong username returns 401 with generic message', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'notadmin', password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('missing password returns 400', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  test('missing username returns 400', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(400);
  });

  test('empty body returns 400', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
  });

  test('does not leak which credential was wrong', async () => {
    const [badUser, badPass] = await Promise.all([
      request(app).post('/auth/login').send({ username: 'nobody',                   password: process.env.ADMIN_PASSWORD }),
      request(app).post('/auth/login').send({ username: process.env.ADMIN_USERNAME, password: 'wrongpass' }),
    ]);
    expect(badUser.body.error).toBe(badPass.body.error);
  });
});

// ── Account lockout ───────────────────────────────────────────────────────────

describe('Account lockout', () => {
  test('account is locked after 5 failed attempts', async () => {
    // 5 bad attempts
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/auth/login')
        .send({ username: process.env.ADMIN_USERNAME, password: 'bad' });
    }

    // 6th attempt should trigger the lockout response
    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: 'bad' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/locked/i);
  });

  test('correct password after lockout still returns locked', async () => {
    // Exhaust the attempts
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/auth/login')
        .send({ username: process.env.ADMIN_USERNAME, password: 'bad' });
    }

    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/locked/i);
  });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  test('logout returns 204 and clears the session cookie', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    const res = await agent.post('/auth/logout');
    expect(res.status).toBe(204);

    // Cookie should be cleared (Max-Age=0 or empty value)
    const cookies = res.headers['set-cookie'] ?? [];
    const sessionCookie = cookies.find(c => c.startsWith('auth_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/Max-Age=0|auth_session=;/i);
  });

  test('session is invalid after logout', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    await agent.post('/auth/logout');

    const res = await agent.get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  test('logout without a session returns 204 (idempotent)', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(204);
  });

  test('double logout returns 204 (idempotent)', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    await agent.post('/auth/logout');
    const second = await agent.post('/auth/logout');
    expect(second.status).toBe(204);
  });
});

// ── GET /auth/session ─────────────────────────────────────────────────────────

describe('GET /auth/session', () => {
  test('returns authenticated=true with user info when logged in', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    const res = await agent.get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authenticated: true,
      user: { username: process.env.ADMIN_USERNAME, role: 'admin' },
    });
  });

  test('returns authenticated=false without a session cookie', async () => {
    const res = await request(app).get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  test('returns authenticated=false with a bogus session cookie', async () => {
    const res = await request(app)
      .get('/auth/session')
      .set('Cookie', 'auth_session=notarealsessionid');

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });
});
