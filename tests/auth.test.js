const request = require('supertest');
const app     = require('../server/app');
const db      = require('../server/config/database');
const { cleanTables } = require('./helpers');

beforeEach(async () => {
  await cleanTables();
});

afterAll(async () => {
  await db.pool.end();
});

// ── POST /auth/login ──────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  test('valid credentials return access_token and set refresh cookie', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      access_token: expect.any(String),
      token_type:   'Bearer',
      expires_in:   900,
    });
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('refresh_token='))).toBe(true);
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
      request(app).post('/auth/login').send({ username: 'nobody',                      password: process.env.ADMIN_PASSWORD }),
      request(app).post('/auth/login').send({ username: process.env.ADMIN_USERNAME,    password: 'wrongpass' }),
    ]);
    // Both should return identical error messages
    expect(badUser.body.error).toBe(badPass.body.error);
  });
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  test('valid refresh token issues new access token and rotates cookie', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    const res = await agent.post('/auth/refresh');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      access_token: expect.any(String),
      token_type:   'Bearer',
      expires_in:   900,
    });
    const cookies = res.headers['set-cookie'] ?? [];
    expect(cookies.some(c => c.startsWith('refresh_token='))).toBe(true);
  });

  test('no refresh token returns 401', async () => {
    const res = await request(app).post('/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No refresh token');
  });

  test('fake/random refresh token returns 401', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', 'refresh_token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(res.status).toBe(401);
  });

  test('token rotation: old token is revoked after first refresh', async () => {
    const agent = request.agent(app);

    // Login
    const loginRes = await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    // Capture the original cookie
    const originalCookie = loginRes.headers['set-cookie'].find(c => c.startsWith('refresh_token='));
    const originalToken  = originalCookie.split(';')[0].replace('refresh_token=', '');

    // First refresh — succeeds and issues a new token
    await agent.post('/auth/refresh');

    // Replay the old token — should be rejected
    const replayRes = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${originalToken}`);

    expect(replayRes.status).toBe(401);
  });

  test('used refresh token cannot be used again (replay attack prevention)', async () => {
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    // Capture the token issued at login before it gets rotated
    const loginCookie = loginRes.headers['set-cookie'].find(c => c.startsWith('refresh_token='));
    const loginToken  = loginCookie.split(';')[0].replace('refresh_token=', '');

    // First refresh succeeds and rotates to a new token
    await agent.post('/auth/refresh');

    // Replaying the original (now-revoked) login token must fail
    const second = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${loginToken}`);
    expect(second.status).toBe(401);
  });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  test('logout returns 204 and clears the cookie', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    const res = await agent.post('/auth/logout');
    expect(res.status).toBe(204);
  });

  test('refresh after logout is rejected with 401', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    await agent.post('/auth/logout');

    const res = await agent.post('/auth/refresh');
    expect(res.status).toBe(401);
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
